-- =====================================================================
-- 0033  Resolve the students in an upload once, not once per row
-- =====================================================================
-- "canceling statement due to statement timeout", on a 2,300-row
-- attendance file.
--
-- Not the serverless limit — this is Postgres, refusing to let one
-- statement run past the ceiling Supabase sets for the authenticated
-- role. The four batch uploads all did the same thing per row:
--
--     select id into v_student
--       from public.user_profiles
--      where role = 'student' and is_active
--        and (lower(coalesce(login_id, '')) = lower(v_ident)
--             or lower(email) = lower(v_ident))
--      limit 1;
--
-- which the planner can only answer with a sequential scan. Measured on
-- the real consolidated export, against a local Postgres with nothing
-- else running:
--
--     the per-row lookups, 2,315 of them ....... 2,588 ms
--     the risk re-evaluation, 2,315 students ...   655 ms
--     everything else ..........................    30 ms
--
-- The lookups were four fifths of the work, and they grow with the
-- roster: more students make every row slower. On a shared instance
-- that is the difference between finishing and being cancelled.
--
-- So they happen once now, for the whole file, through an index. The
-- rest of each function is untouched — same validation, same per-row
-- errors, same return shape.
-- =====================================================================


-- ---------------------------------------------------------------------
-- identifier -> student id, for a whole upload
-- ---------------------------------------------------------------------
-- Returns {"<identifier lowercased>": "<uuid>"} for the identifiers that
-- match a live student, and simply omits the ones that do not — a caller
-- reads a miss as NULL and reports the row exactly as it did before.
create or replace function public.resolve_student_ids(p_identifiers text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with wanted as (
    select distinct lower(btrim(value)) as ident
      from unnest(coalesce(p_identifiers, array[]::text[])) as value
     where btrim(coalesce(value, '')) <> ''
  ),
  candidates as (
    -- Registration number first. If some other student's email happens
    -- to equal this registration number, the registration number wins;
    -- the per-row version left that to whichever row LIMIT 1 reached.
    select w.ident, u.id, 1 as preference
      from wanted w
      join public.user_profiles u
        on lower(u.login_id) = w.ident
     where u.role = 'student' and u.is_active and u.login_id is not null
    union all
    select w.ident, u.id, 2
      from wanted w
      join public.user_profiles u
        on lower(u.email) = w.ident
     where u.role = 'student' and u.is_active
  )
  select coalesce(jsonb_object_agg(ident, id), '{}'::jsonb)
    from (
      select distinct on (ident) ident, id
        from candidates
       order by ident, preference
    ) resolved
$$;

comment on function public.resolve_student_ids(text[]) is
  'Batch identifier -> student id for the upload RPCs. Uses the lower(login_id) and lower(email) unique indexes; replaces a per-row sequential scan.';

revoke all on function public.resolve_student_ids(text[]) from public, anon;
grant execute on function public.resolve_student_ids(text[]) to authenticated, service_role;



-- ---------------------------------------------------------------------
-- record_attendance_batch
-- ---------------------------------------------------------------------
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
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload attendance' using errcode = '42501';
  end if;
  if p_course_code is null or btrim(p_course_code) = '' then
    raise exception 'No course code found in the file header' using errcode = '22023';
  end if;

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

  -- Every registration number in the file, resolved in one pass.
  --
  -- This used to be a query per row, and it could not use either unique
  -- index: lower(coalesce(login_id, '')) is not the indexed expression
  -- lower(login_id), and the OR against lower(email) rules out a single
  -- index path anyway. So each row sequentially scanned user_profiles —
  -- 2,300 rows over 2,700 students is six million row visits, which is
  -- what ran the upload past the statement timeout. The file's size
  -- barely matters now.
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
    -- One hash lookup against the map built before the loop.
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


-- ---------------------------------------------------------------------
-- record_gpa_batch
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_gpa_batch(p_semester_number smallint, p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch_id uuid;
  v_item     jsonb;
  v_ident    text;
  v_idents   text[];
  v_lookup   jsonb;
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

  -- Every registration number in the file, resolved in one pass.
  --
  -- This used to be a query per row, and it could not use either unique
  -- index: lower(coalesce(login_id, '')) is not the indexed expression
  -- lower(login_id), and the OR against lower(email) rules out a single
  -- index path anyway. So each row sequentially scanned user_profiles —
  -- 2,300 rows over 2,700 students is six million row visits, which is
  -- what ran the upload past the statement timeout. The file's size
  -- barely matters now.
  select array_agg(distinct btrim(coalesce(value ->> 'identifier', '')))
    into v_idents
    from jsonb_array_elements(p_rows)
   where btrim(coalesce(value ->> 'identifier', '')) <> '';
  v_lookup := public.resolve_student_ids(coalesce(v_idents, array[]::text[]));

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

    -- One hash lookup against the map built before the loop.
    v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;

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
$function$;


-- ---------------------------------------------------------------------
-- record_backlog_batch
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_backlog_batch(p_semester_number smallint, p_exam_session text, p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch_id uuid;
  v_item     jsonb;
  v_ident    text;
  v_idents   text[];
  v_lookup   jsonb;
  v_student  uuid;
  v_code     text;
  v_name     text;
  v_cleared  boolean;
  v_matched  integer := 0;
  v_failed   integer := 0;
  v_total    integer := 0;
  v_errors   jsonb   := '[]'::jsonb;
  v_touched  uuid[]  := array[]::uuid[];
  v_sid      uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload backlog data' using errcode = '42501';
  end if;
  if p_semester_number is null or p_semester_number < 1 or p_semester_number > 8 then
    raise exception 'Pick a semester between 1 and 8' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, semester_number, original_filename, total_rows
  )
  values (auth.uid(), 'backlog', p_semester_number, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  -- Every registration number in the file, resolved in one pass.
  --
  -- This used to be a query per row, and it could not use either unique
  -- index: lower(coalesce(login_id, '')) is not the indexed expression
  -- lower(login_id), and the OR against lower(email) rules out a single
  -- index path anyway. So each row sequentially scanned user_profiles —
  -- 2,300 rows over 2,700 students is six million row visits, which is
  -- what ran the upload past the statement timeout. The file's size
  -- barely matters now.
  select array_agg(distinct btrim(coalesce(value ->> 'identifier', '')))
    into v_idents
    from jsonb_array_elements(p_rows)
   where btrim(coalesce(value ->> 'identifier', '')) <> '';
  v_lookup := public.resolve_student_ids(coalesce(v_idents, array[]::text[]));

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total   := v_total + 1;
    v_ident   := btrim(coalesce(v_item ->> 'identifier', ''));
    v_code    := btrim(coalesce(v_item ->> 'subject_code', ''));
    v_name    := nullif(btrim(coalesce(v_item ->> 'subject_name', '')), '');
    v_cleared := coalesce((v_item ->> 'is_cleared')::boolean, false);

    if v_ident = '' or v_code = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total,
                                                 'reason', 'Each row needs a registration number and a subject code');
      continue;
    end if;

    -- One hash lookup against the map built before the loop.
    v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;

    if v_student is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No student matches this registration number or email');
      continue;
    end if;

    insert into public.student_backlogs (
      student_id, subject_code, subject_name, semester_number,
      exam_session, is_cleared, cleared_at, batch_id, recorded_by
    )
    values (v_student, v_code, v_name, p_semester_number,
            nullif(btrim(coalesce(p_exam_session, '')), ''), v_cleared,
            case when v_cleared then now() end, v_batch_id, auth.uid())
    on conflict (student_id, subject_code, semester_number) do update
      set subject_name = coalesce(excluded.subject_name, public.student_backlogs.subject_name),
          exam_session = coalesce(excluded.exam_session, public.student_backlogs.exam_session),
          is_cleared   = excluded.is_cleared,
          cleared_at   = case when excluded.is_cleared then coalesce(public.student_backlogs.cleared_at, now()) else null end,
          batch_id     = excluded.batch_id,
          recorded_by  = excluded.recorded_by,
          updated_at   = now();

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
$function$;


-- ---------------------------------------------------------------------
-- map_students_to_mentors
-- ---------------------------------------------------------------------
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
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can map mentors' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  -- Every registration number in the file, resolved in one pass.
  --
  -- This used to be a query per row, and it could not use either unique
  -- index: lower(coalesce(login_id, '')) is not the indexed expression
  -- lower(login_id), and the OR against lower(email) rules out a single
  -- index path anyway. So each row sequentially scanned user_profiles —
  -- 2,300 rows over 2,700 students is six million row visits, which is
  -- what ran the upload past the statement timeout. The file's size
  -- barely matters now.
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

    -- One hash lookup against the map built before the loop.
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
