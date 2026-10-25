-- =====================================================================
-- 0035  Black dots, and the ERP's own GPA and backlog exports
-- =====================================================================
-- Three file layouts the Cluster Head actually receives, replacing the
-- hand-made CSVs the earlier uploads were designed around:
--
--   1. BLACK DOTS: the Proctorial Board's "Notice of PB meeting" (.docx).
--      One table per case:
--        Case No: 034/Even Sem/2026. The undermentioned students were ...
--        S/No | Regn No | Name | Date of Incidence | Block | Room No |
--        Course/Branch | Mob No | Previous Record
--      Every student row is one black dot on that student's record.
--
--   2. GPA: the ERP's "Student's CGPA / GPA & Credits" export (.xls):
--        Registration No. | Student Name | CGPA | Total Earned Credits |
--        Total Required Credits | Semester I (GPA, Earned, Req) | ...
--      Every graded semester in the file is recorded at once, together
--      with the official CGPA and credits, which had nowhere to live.
--
--   3. BACKLOGS: the ERP's "Defaulter Grade" result export (.xls):
--        RESULT OF END TERM EXAMINATION -24-25 / <programme> - III SEMESTER
--        Registration No | Student Name | IIS2121 | MEE2001 | ...  (F, UFM, DT)
--        + a Subject Code / Description / Credit table underneath.
--      It lists defaulters only, so it is read as the complete list for
--      that semester: a subject that was open and is now blank, or whose
--      student is no longer listed, has been cleared.
--
-- REGISTRATION NUMBER IS THE KEY
-- ---------------------------------------------------------------------
-- Every Cluster Head upload now matches students on registration number
-- (user_profiles.login_id) and nothing else. resolve_student_ids() used
-- to fall back to email; it no longer does, so attendance and the mentor
-- map follow the same rule without their own functions changing.
--
-- Also fixed on the way through, because these functions were rewritten
-- anyway (numbers from the master documentation):
--   S3  resolve_student_ids() had no caller check.
--   S5  (in part) a student could edit their own registration number,
--       the key every upload matches on. It is now a protected column.
--   B6  subject codes match case-insensitively, and a file without a
--       Cleared column no longer re-opens cleared backlogs.
--   B7  a non-numeric GPA cell is a row error, not an aborted upload.
--   B8  the GPA upload writes skipped_rows.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Two helpers for reading spreadsheet cells
-- ---------------------------------------------------------------------
-- In the ERP exports "-" means "nothing here": a semester not graded yet,
-- an unused elective. It is treated exactly like an empty cell.
create or replace function public.is_blank_mark(p_value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(lower(btrim(p_value)), '') in ('', '-', '--', '—', '–', 'na', 'n/a', 'n.a.');
$$;

comment on function public.is_blank_mark(text) is
  'True for an empty cell or a placeholder the ERP exports use for "nothing here" (-, NA, N/A).';

-- '7.26' -> 7.26; anything that is not a plain decimal -> NULL. A stray
-- word in a GPA column then becomes a row error instead of aborting the
-- whole upload with "invalid input syntax for type numeric" (B7).
create or replace function public.try_numeric(p_value text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when btrim(coalesce(p_value, '')) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'
             then btrim(p_value)::numeric
         end;
$$;

comment on function public.try_numeric(text) is
  'Parses a plain decimal, returning NULL instead of raising for anything else.';

revoke all on function public.is_blank_mark(text) from public, anon;
revoke all on function public.try_numeric(text)   from public, anon;
grant execute on function public.is_blank_mark(text) to authenticated, service_role;
grant execute on function public.try_numeric(text)   to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2. Registration number only, and only for the people who upload
-- ---------------------------------------------------------------------
-- Same one-pass lookup as 0033, minus the email fallback, plus the caller
-- check it never had (S3): it used to map registration numbers to account
-- ids for any signed-in user. Every caller is an upload function that is
-- itself limited to a cluster head, the HOD or a trusted server call.
create or replace function public.resolve_student_ids(p_identifiers text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can match registration numbers'
      using errcode = '42501';
  end if;

  -- lower(login_id) is unique (user_profiles_login_id_unique_idx), so
  -- each registration number maps to at most one account.
  return (
    select coalesce(jsonb_object_agg(wanted.ident, u.id), '{}'::jsonb)
      from (
        select distinct lower(btrim(value)) as ident
          from unnest(coalesce(p_identifiers, array[]::text[])) as value
         where btrim(coalesce(value, '')) <> ''
      ) wanted
      join public.user_profiles u
        on lower(u.login_id) = wanted.ident
     where u.role = 'student'
       and u.is_active
  );
end;
$$;

comment on function public.resolve_student_ids(text[]) is
  'Registration number -> student id for a whole upload, via the lower(login_id) unique index. Registration number only; cluster head, HOD or trusted server calls only.';

revoke all on function public.resolve_student_ids(text[]) from public, anon;
grant execute on function public.resolve_student_ids(text[]) to authenticated, service_role;

-- A key the account holder can edit is not a key. Until now a student
-- could PATCH their own login_id (S5), and every upload would then miss
-- them: no GPA, no backlog, no black dot. The registration number now
-- joins the protected columns; the roster import, the seed (no JWT) and
-- the HOD can still set it. Everything else is verbatim from 0021, since a
-- CREATE OR REPLACE has to restate the whole body.
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
  if new.login_id is distinct from old.login_id then
    raise exception 'Not permitted: the registration number is managed by the department'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Upload history says what each file covered
-- ---------------------------------------------------------------------
-- One GPA file now spans several semesters and a black dot notice spans
-- several cases, so a single semester_number no longer describes them.
alter table public.academic_upload_batches
  add column if not exists scope_label text;

comment on column public.academic_upload_batches.scope_label is
  'What the file covered, in words ("Semesters 1, 2 + CGPA", "Semester 3 · END TERM ...", "2 cases"). Written by the upload functions for the Recent uploads list.';

comment on table public.academic_upload_batches is
  'One row per Cluster Head upload (attendance / GPA / backlog / black dot), including the rows that could not be matched to a student.';


-- ---------------------------------------------------------------------
-- 4. GPA: credits per semester, and the official CGPA
-- ---------------------------------------------------------------------
alter table public.student_semester_gpas
  add column if not exists earned_credits   numeric(5,2),
  add column if not exists required_credits numeric(5,2);

do $$ begin
  alter table public.student_semester_gpas
    add constraint semester_gpa_credits_sane check (
      (earned_credits is null or earned_credits between 0 and 100)
      and (required_credits is null or required_credits between 0 and 100)
    );
exception when duplicate_object then null; end $$;

comment on column public.student_semester_gpas.earned_credits is
  'Credits earned that semester, from the ERP CGPA/GPA & Credits export. NULL for self-reported GPA.';
comment on column public.student_semester_gpas.required_credits is
  'Credits required that semester, from the same export. Usually only filled for the semester in progress.';

-- The CGPA the university publishes is credit-weighted, so it is not the
-- mean of the semester GPAs every screen used to show in its place.
create table if not exists public.student_cgpas (
  student_id              uuid primary key references public.user_profiles (id) on delete cascade,
  cgpa                    numeric(4,2) not null,
  total_earned_credits    numeric(6,2),
  total_required_credits  numeric(6,2),
  batch_id                uuid references public.academic_upload_batches (id) on delete set null,
  recorded_by             uuid references public.user_profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint student_cgpas_range check (cgpa between 0 and 10),
  constraint student_cgpas_credits_sane check (
    (total_earned_credits is null or total_earned_credits between 0 and 400)
    and (total_required_credits is null or total_required_credits between 0 and 400)
  )
);

drop trigger if exists trg_student_cgpas_updated_at on public.student_cgpas;
create trigger trg_student_cgpas_updated_at
  before update on public.student_cgpas
  for each row execute function public.set_updated_at_timestamp();

comment on table public.student_cgpas is
  'Official CGPA and credit totals per student, from the ERP export uploaded by a Cluster Head. Same visibility as semester GPAs.';

alter table public.student_cgpas enable row level security;

drop policy if exists cgpas_select_permitted on public.student_cgpas;

-- Exactly the gate on student_semester_gpas: the student, the HOD, and the
-- mentor when GPA sharing is on. Cluster heads upload GPA but cannot read
-- it, as before. No write policies: only record_gpa_batch() writes here.
create policy cgpas_select_permitted on public.student_cgpas
  for select to authenticated
  using (public.can_view_student_gpa(student_id));

grant select on public.student_cgpas to authenticated;


-- ---------------------------------------------------------------------
-- 5. Backlogs keep the grade and the subject's credits
-- ---------------------------------------------------------------------
alter table public.student_backlogs
  add column if not exists grade   text,
  add column if not exists credits numeric(4,2);

comment on column public.student_backlogs.grade is
  'The defaulter grade from the result export (F, UFM, DT, ...). Kept after the backlog is cleared.';
comment on column public.student_backlogs.credits is
  'Credits for the subject, from the Subject Code / Credit table under the result export.';

-- The clearing pass in record_backlog_batch() looks for open backlogs by
-- semester and subject.
create index if not exists student_backlogs_open_by_subject_idx
  on public.student_backlogs (semester_number, upper(subject_code))
  where is_cleared = false;


-- ---------------------------------------------------------------------
-- 6. Black dots
-- ---------------------------------------------------------------------
-- One row per student per Proctorial Board case. The student's name is
-- not stored (the account has it); everything else in the notice is.
create table if not exists public.student_black_dots (
  id                    uuid primary key default extensions.gen_random_uuid(),
  student_id            uuid not null references public.user_profiles (id) on delete cascade,
  case_number           text not null,
  case_details          text,
  incident_date         date,
  incident_date_text    text,
  hostel_block          text,
  room_no               text,
  course_branch         text,
  mobile_no             text,
  previous_record       text,
  previous_black_dots   smallint,
  batch_id              uuid references public.academic_upload_batches (id) on delete set null,
  recorded_by           uuid references public.user_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint student_black_dots_case_not_blank check (public.is_non_blank(case_number)),
  constraint student_black_dots_previous_sane check (previous_black_dots is null or previous_black_dots between 0 and 100)
);

-- Uploading the same notice twice updates rather than duplicates.
create unique index if not exists student_black_dots_one_per_case
  on public.student_black_dots (student_id, lower(case_number));
create index if not exists student_black_dots_student_idx
  on public.student_black_dots (student_id, incident_date desc);

drop trigger if exists trg_student_black_dots_updated_at on public.student_black_dots;
create trigger trg_student_black_dots_updated_at
  before update on public.student_black_dots
  for each row execute function public.set_updated_at_timestamp();

comment on table public.student_black_dots is
  'Disciplinary black dots from Proctorial Board notices, one row per student per case. Uploaded by a Cluster Head; not part of the at-risk rule.';
comment on column public.student_black_dots.incident_date_text is
  'The date exactly as the notice wrote it ("14TH August"). incident_date is filled only when that is a complete date.';
comment on column public.student_black_dots.previous_record is
  'The notice''s "Previous Record" column as written ("1 black dot", "NIL"). previous_black_dots is the number read from it.';

alter table public.student_black_dots enable row level security;

drop policy if exists black_dots_select_visible  on public.student_black_dots;
drop policy if exists black_dots_select_uploader on public.student_black_dots;

-- The student, their mentor or the HOD: the same rule as backlogs.
create policy black_dots_select_visible on public.student_black_dots
  for select to authenticated
  using (public.can_access_student(student_id));

-- The cluster head who uploaded a row can see that row and nothing else.
create policy black_dots_select_uploader on public.student_black_dots
  for select to authenticated
  using (recorded_by = auth.uid() and public.is_cluster_head());

-- No INSERT/UPDATE/DELETE policy: record_black_dot_batch() is the only writer.
grant select on public.student_black_dots to authenticated;


-- ---------------------------------------------------------------------
-- 7. record_gpa_batch: the whole CGPA / GPA & Credits export at once
-- ---------------------------------------------------------------------
-- Each row of p_rows is one student:
--   { "row": 7, "identifier": "2502050550", "cgpa": "7.26",
--     "total_earned_credits": "40.00", "total_required_credits": "-",
--     "semesters": [ { "semester_number": 1, "gpa": "7.68",
--                      "earned_credits": "20.00", "required_credits": "-" }, ... ] }
-- The older flat shape, { "identifier", "gpa", "semester_number" }, is
-- still accepted and treated as one semester (p_semester_number is its
-- fallback semester, as before). A row is recorded completely or not at
-- all, so a bad cell never leaves a student half-updated.
CREATE OR REPLACE FUNCTION public.record_gpa_batch(p_semester_number smallint, p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch_id      uuid;
  v_item          jsonb;
  v_entry         jsonb;
  v_semesters     jsonb;
  v_clean         jsonb;
  v_row           integer;
  v_ident         text;
  v_idents        text[];
  v_lookup        jsonb;
  v_student       uuid;
  v_problem       text;
  v_cgpa          numeric;
  v_earned        numeric;
  v_required      numeric;
  v_semester      numeric;
  v_gpa           numeric;
  v_sem_earned    numeric;
  v_sem_required  numeric;
  v_matched       integer := 0;
  v_failed        integer := 0;
  v_skipped       integer := 0;
  v_total         integer := 0;
  v_gpa_rows      integer := 0;
  v_cgpa_rows     integer := 0;
  v_errors        jsonb   := '[]'::jsonb;
  v_touched       uuid[]  := array[]::uuid[];
  v_semester_set  integer[] := array[]::integer[];
  v_sid           uuid;
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

  -- Every registration number in the file, resolved in one pass (0033).
  select array_agg(distinct btrim(coalesce(value ->> 'identifier', '')))
    into v_idents
    from jsonb_array_elements(p_rows)
   where btrim(coalesce(value ->> 'identifier', '')) <> '';
  v_lookup := public.resolve_student_ids(coalesce(v_idents, array[]::text[]));

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total    := v_total + 1;
    -- The spreadsheet's own row number when the parser sent one, so the
    -- error list points at a line the Cluster Head can find.
    v_row      := coalesce(public.try_numeric(v_item ->> 'row')::integer, v_total);
    v_ident    := btrim(coalesce(v_item ->> 'identifier', ''));
    v_problem  := null;
    v_clean    := '[]'::jsonb;
    v_cgpa     := null;
    v_earned   := null;
    v_required := null;

    if jsonb_typeof(v_item -> 'semesters') = 'array' then
      v_semesters := v_item -> 'semesters';
    elsif v_item ? 'gpa' then
      v_semesters := jsonb_build_array(jsonb_build_object(
        'semester_number', coalesce(nullif(btrim(coalesce(v_item ->> 'semester_number', '')), ''),
                                    p_semester_number::text),
        'gpa', v_item ->> 'gpa'));
    else
      v_semesters := '[]'::jsonb;
    end if;

    if v_ident = '' then
      v_problem := 'No registration number in this row';
    elsif position('@' in v_ident) > 0 then
      v_problem := 'This is an email address. Rows are matched on registration number only';
    end if;

    -- CGPA and the two credit totals are optional, but a value that is
    -- present has to make sense.
    if v_problem is null and not public.is_blank_mark(v_item ->> 'cgpa') then
      v_cgpa := public.try_numeric(v_item ->> 'cgpa');
      if v_cgpa is null or v_cgpa < 0 or v_cgpa > 10 then
        v_problem := format('CGPA "%s" is not a number between 0 and 10', btrim(v_item ->> 'cgpa'));
      end if;
    end if;
    if v_problem is null and not public.is_blank_mark(v_item ->> 'total_earned_credits') then
      v_earned := public.try_numeric(v_item ->> 'total_earned_credits');
      if v_earned is null or v_earned < 0 or v_earned > 400 then
        v_problem := format('Total earned credits "%s" is not a number between 0 and 400',
                            btrim(v_item ->> 'total_earned_credits'));
      end if;
    end if;
    if v_problem is null and not public.is_blank_mark(v_item ->> 'total_required_credits') then
      v_required := public.try_numeric(v_item ->> 'total_required_credits');
      if v_required is null or v_required < 0 or v_required > 400 then
        v_problem := format('Total required credits "%s" is not a number between 0 and 400',
                            btrim(v_item ->> 'total_required_credits'));
      end if;
    end if;

    -- A semester whose GPA is "-" has not been graded yet and is left out.
    if v_problem is null then
      for v_entry in select * from jsonb_array_elements(v_semesters)
      loop
        continue when public.is_blank_mark(v_entry ->> 'gpa');

        v_semester := public.try_numeric(v_entry ->> 'semester_number');
        if v_semester is null then
          v_problem := 'No semester on this row, and none chosen for the upload';
          exit;
        end if;
        if v_semester <> trunc(v_semester) or v_semester < 1 or v_semester > 8 then
          v_problem := format('Semester %s is outside 1-8', btrim(v_entry ->> 'semester_number'));
          exit;
        end if;

        v_gpa := public.try_numeric(v_entry ->> 'gpa');
        if v_gpa is null or v_gpa < 0 or v_gpa > 10 then
          v_problem := format('Semester %s GPA "%s" is not a number between 0 and 10',
                              v_semester, btrim(v_entry ->> 'gpa'));
          exit;
        end if;

        v_sem_earned := null;
        v_sem_required := null;
        if not public.is_blank_mark(v_entry ->> 'earned_credits') then
          v_sem_earned := public.try_numeric(v_entry ->> 'earned_credits');
          if v_sem_earned is null or v_sem_earned < 0 or v_sem_earned > 100 then
            v_problem := format('Semester %s earned credits "%s" is not a number between 0 and 100',
                                v_semester, btrim(v_entry ->> 'earned_credits'));
            exit;
          end if;
        end if;
        if not public.is_blank_mark(v_entry ->> 'required_credits') then
          v_sem_required := public.try_numeric(v_entry ->> 'required_credits');
          if v_sem_required is null or v_sem_required < 0 or v_sem_required > 100 then
            v_problem := format('Semester %s required credits "%s" is not a number between 0 and 100',
                                v_semester, btrim(v_entry ->> 'required_credits'));
            exit;
          end if;
        end if;

        v_clean := v_clean || jsonb_build_object(
          'semester', v_semester::integer, 'gpa', v_gpa,
          'earned', v_sem_earned, 'required', v_sem_required);
      end loop;
    end if;

    if v_problem is null then
      v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;
      if v_student is null then
        v_problem := 'No student matches this registration number';
      end if;
    end if;

    if v_problem is not null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row, 'identifier', nullif(v_ident, ''),
                                                 'reason', v_problem);
      continue;
    end if;

    -- A row of dashes (a student with nothing graded yet) is not an error,
    -- there is just nothing to record.
    if jsonb_array_length(v_clean) = 0 and v_cgpa is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    for v_entry in select * from jsonb_array_elements(v_clean)
    loop
      insert into public.student_semester_gpas as g (
        student_id, semester_number, gpa, earned_credits, required_credits,
        source, recorded_by, batch_id
      )
      values (
        v_student, (v_entry ->> 'semester')::smallint, round((v_entry ->> 'gpa')::numeric, 2),
        (v_entry ->> 'earned')::numeric, (v_entry ->> 'required')::numeric,
        'cluster_head', auth.uid(), v_batch_id
      )
      on conflict (student_id, semester_number) do update
        set gpa              = excluded.gpa,
            -- A flat file carries no credits; it should not wipe the ones
            -- the ERP export recorded.
            earned_credits   = coalesce(excluded.earned_credits, g.earned_credits),
            required_credits = coalesce(excluded.required_credits, g.required_credits),
            source           = 'cluster_head',
            recorded_by      = excluded.recorded_by,
            batch_id         = excluded.batch_id,
            updated_at       = now();

      v_gpa_rows := v_gpa_rows + 1;
      if not ((v_entry ->> 'semester')::integer = any (v_semester_set)) then
        v_semester_set := v_semester_set || (v_entry ->> 'semester')::integer;
      end if;
    end loop;

    if v_cgpa is not null then
      insert into public.student_cgpas (
        student_id, cgpa, total_earned_credits, total_required_credits, batch_id, recorded_by
      )
      values (v_student, round(v_cgpa, 2), v_earned, v_required, v_batch_id, auth.uid())
      on conflict (student_id) do update
        set cgpa                   = excluded.cgpa,
            total_earned_credits   = excluded.total_earned_credits,
            total_required_credits = excluded.total_required_credits,
            batch_id               = excluded.batch_id,
            recorded_by            = excluded.recorded_by,
            updated_at             = now();
      v_cgpa_rows := v_cgpa_rows + 1;
    end if;

    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  select coalesce(array_agg(s order by s), array[]::integer[])
    into v_semester_set
    from unnest(v_semester_set) as s;

  update public.academic_upload_batches
     set matched_rows = v_matched,
         failed_rows  = v_failed,
         skipped_rows = v_skipped,
         row_errors   = v_errors,
         scope_label  = case
                          when array_length(v_semester_set, 1) is null then
                            case when v_cgpa_rows > 0 then 'CGPA only' end
                          when array_length(v_semester_set, 1) = 1 then
                            'Semester ' || v_semester_set[1]
                          else
                            'Semesters ' || array_to_string(v_semester_set, ', ')
                        end
                        || case when v_cgpa_rows > 0 and array_length(v_semester_set, 1) is not null
                                then ' + CGPA' else '' end
   where id = v_batch_id;

  -- The at-risk rule reads the highest-numbered graded semester, which
  -- this upload may just have changed.
  foreach v_sid in array v_touched loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', v_total,
    'matched', v_matched,
    'failed', v_failed,
    'skipped', v_skipped,
    'semester_gpas_recorded', v_gpa_rows,
    'semesters', to_jsonb(v_semester_set),
    'cgpa_recorded', v_cgpa_rows,
    'students_reevaluated', coalesce(array_length(v_touched, 1), 0),
    'row_errors', v_errors
  );
end;
$function$;

comment on function public.record_gpa_batch(smallint, text, jsonb) is
  'One GPA upload: every graded semester per student (GPA and credits) plus the official CGPA, matched on registration number. Re-evaluates risk.';

revoke all on function public.record_gpa_batch(smallint, text, jsonb) from public, anon;
grant execute on function public.record_gpa_batch(smallint, text, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 8. record_backlog_batch: the Defaulter Grade export
-- ---------------------------------------------------------------------
-- New last parameter, so the old four-argument version is dropped rather
-- than left behind as an ambiguous overload.
--
-- Each row of p_rows is one student from the defaulter list:
--   { "row": 4, "identifier": "2428020003",
--     "grades": [ { "subject_code": "MEE2001", "subject_name": "ENGINEERING ECONOMICS",
--                   "credits": "3.00", "grade": "F" }, ... ] }
-- p_subject_codes is every subject column in the file. When it is given,
-- the file is the complete defaulter list for p_semester_number: any open
-- backlog in one of those subjects that the file no longer marks is
-- cleared. Subjects the file does not name are never touched.
--
-- The older one-subject-per-row shape, { "identifier", "subject_code",
-- "subject_name", "is_cleared" }, still works, without the clearing pass.
drop function if exists public.record_backlog_batch(smallint, text, text, jsonb);

create or replace function public.record_backlog_batch(
  p_semester_number smallint,
  p_exam_session    text,
  p_filename        text,
  p_rows            jsonb,
  p_subject_codes   text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  -- Grades that mean the subject is still owed. Anything else found in a
  -- subject cell is reported back and left alone rather than guessed at.
  v_fail_grades constant text[] := array[
    'F', 'FA', 'FAIL', 'FAILED', 'UFM', 'DT', 'DB', 'DX', 'AB', 'ABS', 'ABSENT',
    'I', 'X', 'NC', 'DETAINED', 'DEBARRED'
  ];
  v_session       text := nullif(btrim(coalesce(p_exam_session, '')), '');
  v_codes         text[];
  v_marked        text[] := array[]::text[];
  v_batch_id      uuid;
  v_item          jsonb;
  v_entry         jsonb;
  v_entries       jsonb;
  v_long          boolean;
  v_row           integer;
  v_ident         text;
  v_idents        text[];
  v_lookup        jsonb;
  v_student       uuid;
  v_problem       text;
  v_code          text;
  v_name          text;
  v_grade         text;
  v_credits       numeric;
  v_flag          text;
  v_cleared       boolean;
  v_state         boolean;
  v_open          integer := 0;
  v_closed        integer := 0;
  v_matched       integer := 0;
  v_failed        integer := 0;
  v_total         integer := 0;
  v_errors        jsonb   := '[]'::jsonb;
  v_touched       uuid[]  := array[]::uuid[];
  v_sid           uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload backlog data' using errcode = '42501';
  end if;
  if p_semester_number is null or p_semester_number < 1 or p_semester_number > 8 then
    raise exception 'The file does not say which semester it is for. Pick a semester between 1 and 8'
      using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct upper(btrim(code))), array[]::text[])
    into v_codes
    from unnest(coalesce(p_subject_codes, array[]::text[])) as code
   where btrim(coalesce(code, '')) <> '';

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, semester_number, original_filename, total_rows
  )
  values (auth.uid(), 'backlog', p_semester_number, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
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
    v_problem := null;
    v_long    := jsonb_typeof(v_item -> 'grades') is distinct from 'array';

    if v_long then
      v_entries := jsonb_build_array(jsonb_build_object(
        'subject_code', v_item -> 'subject_code',
        'subject_name', v_item -> 'subject_name',
        'grade',        v_item -> 'grade',
        'credits',      v_item -> 'credits',
        'is_cleared',   v_item -> 'is_cleared'));
    else
      v_entries := v_item -> 'grades';
    end if;

    if v_ident = '' then
      v_problem := 'No registration number in this row';
    elsif position('@' in v_ident) > 0 then
      v_problem := 'This is an email address. Rows are matched on registration number only';
    elsif v_long and btrim(coalesce(v_item ->> 'subject_code', '')) = '' then
      v_problem := 'Each row needs a registration number and a subject code';
    end if;

    if v_problem is null then
      v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;
      if v_student is null then
        v_problem := 'No student matches this registration number';
      end if;
    end if;

    if v_problem is not null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row, 'identifier', nullif(v_ident, ''),
                                                 'reason', v_problem);
      continue;
    end if;

    for v_entry in select * from jsonb_array_elements(v_entries)
    loop
      v_code := upper(btrim(coalesce(v_entry ->> 'subject_code', '')));
      continue when v_code = '';

      v_name    := nullif(btrim(coalesce(v_entry ->> 'subject_name', '')), '');
      v_grade   := upper(btrim(coalesce(v_entry ->> 'grade', '')));
      v_credits := public.try_numeric(v_entry ->> 'credits');
      if v_credits is not null and (v_credits < 0 or v_credits > 99) then
        v_credits := null;
      end if;

      if v_long then
        -- The hand-made file says so explicitly or says nothing. A blank
        -- Cleared cell leaves an existing backlog's state alone (B6).
        v_flag := lower(btrim(coalesce(v_entry ->> 'is_cleared', '')));
        v_cleared := case
          when v_flag in ('true', 'yes', 'y', 'cleared', 'pass', 'passed', '1') then true
          when v_flag in ('false', 'no', 'n', 'not cleared', 'fail', 'failed', '0') then false
        end;
        if public.is_blank_mark(v_grade) then
          v_grade := null;
        end if;
      else
        continue when public.is_blank_mark(v_grade);
        -- Whatever the cell says, the file has spoken about this subject
        -- for this student, so the clearing pass below must leave it be.
        v_marked := v_marked || (v_student::text || '|' || v_code);
        if not (v_grade = any (v_fail_grades)) then
          v_errors := v_errors || jsonb_build_object(
            'row', v_row, 'identifier', v_ident,
            'reason', format('%s: "%s" is not a fail grade, so nothing was changed for this subject',
                             v_code, v_grade));
          continue;
        end if;
        v_cleared := false;
      end if;

      -- Matched case-insensitively (B6): "iis2121" and "IIS2121" are the
      -- same subject, whatever an earlier upload stored.
      v_state := null;
      update public.student_backlogs b
         set subject_name = coalesce(v_name, b.subject_name),
             exam_session = coalesce(v_session, b.exam_session),
             grade        = coalesce(v_grade, b.grade),
             credits      = coalesce(v_credits, b.credits),
             is_cleared   = coalesce(v_cleared, b.is_cleared),
             cleared_at   = case when coalesce(v_cleared, b.is_cleared)
                                 then coalesce(b.cleared_at, now()) end,
             batch_id     = v_batch_id,
             recorded_by  = coalesce(auth.uid(), b.recorded_by),
             updated_at   = now()
       where b.student_id = v_student
         and b.semester_number = p_semester_number
         and upper(b.subject_code) = v_code
      returning b.is_cleared into v_state;

      if not found then
        v_state := coalesce(v_cleared, false);
        insert into public.student_backlogs (
          student_id, subject_code, subject_name, semester_number, exam_session,
          grade, credits, is_cleared, cleared_at, batch_id, recorded_by
        )
        values (
          v_student, v_code, v_name, p_semester_number, v_session,
          v_grade, v_credits, v_state, case when v_state then now() end,
          v_batch_id, auth.uid()
        );
      end if;

      if v_state then
        v_closed := v_closed + 1;
      else
        v_open := v_open + 1;
      end if;
    end loop;

    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  -- The defaulter list is the whole truth for the subjects it names: an
  -- open backlog it no longer marks has been cleared, whether the student
  -- is still listed for something else or not listed at all.
  if array_length(v_codes, 1) is not null then
    for v_sid in
      update public.student_backlogs b
         set is_cleared  = true,
             cleared_at  = coalesce(b.cleared_at, now()),
             batch_id    = v_batch_id,
             recorded_by = coalesce(auth.uid(), b.recorded_by),
             updated_at  = now()
       where b.semester_number = p_semester_number
         and b.is_cleared = false
         and upper(b.subject_code) = any (v_codes)
         and not ((b.student_id::text || '|' || upper(b.subject_code)) = any (v_marked))
      returning b.student_id
    loop
      v_closed := v_closed + 1;
      if not (v_sid = any (v_touched)) then
        v_touched := v_touched || v_sid;
      end if;
    end loop;
  end if;

  update public.academic_upload_batches
     set matched_rows = v_matched,
         failed_rows  = v_failed,
         row_errors   = v_errors,
         scope_label  = 'Semester ' || p_semester_number || coalesce(' · ' || v_session, '')
   where id = v_batch_id;

  foreach v_sid in array v_touched loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', v_total,
    'matched', v_matched,
    'failed', v_failed,
    'semester_number', p_semester_number,
    'exam_session', v_session,
    'backlogs_recorded', v_open,
    'backlogs_cleared', v_closed,
    'students_reevaluated', coalesce(array_length(v_touched, 1), 0),
    'row_errors', v_errors
  );
end;
$function$;

comment on function public.record_backlog_batch(smallint, text, text, jsonb, text[]) is
  'One backlog upload for a semester, matched on registration number. With p_subject_codes the file is the complete defaulter list for those subjects and anything it no longer marks is cleared. Re-evaluates risk.';

revoke all on function public.record_backlog_batch(smallint, text, text, jsonb, text[]) from public, anon;
grant execute on function public.record_backlog_batch(smallint, text, text, jsonb, text[]) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 9. record_black_dot_batch: the Proctorial Board notice
-- ---------------------------------------------------------------------
-- Each row of p_rows is one student under one case:
--   { "row": 3, "where": "Case 034/Even Sem/2026 · S/No 1",
--     "identifier": "2428020221", "name": "John Doe",
--     "case_number": "034/Even Sem/2026",
--     "case_details": "The undermentioned students were involved in possession of banned items.",
--     "incident_date": "2026-09-10", "incident_date_text": "10/09/26",
--     "hostel_block": "B7", "room_no": "214", "course_branch": "B Tech ECE, Sec- F1",
--     "mobile_no": "...", "previous_record": "1 black dot" }
-- Black dots are not part of the at-risk rule, so nothing is re-evaluated.
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
      -- A Word table has no row numbers; "where" is the case and S/No the
      -- Cluster Head can find in the notice.
      v_errors := v_errors || jsonb_build_object('row', v_row, 'identifier', nullif(v_ident, ''),
                                                 'where', nullif(btrim(coalesce(v_item ->> 'where', '')), ''),
                                                 'reason', v_problem);
      continue;
    end if;

    -- The parser only sends a date it could read completely; a notice that
    -- says "14TH August" keeps that text and no date.
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

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', v_total,
    'matched', v_matched,
    'failed', v_failed,
    'cases', coalesce(array_length(v_cases, 1), 0),
    'case_numbers', to_jsonb(v_cases),
    'students', coalesce(array_length(v_students, 1), 0),
    'row_errors', v_errors
  );
end;
$function$;

comment on function public.record_black_dot_batch(text, jsonb) is
  'One Proctorial Board notice: a black dot per student per case, matched on registration number, with a name check against the account. Re-uploading a notice updates its rows.';

revoke all on function public.record_black_dot_batch(text, jsonb) from public, anon;
grant execute on function public.record_black_dot_batch(text, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 10. The student record shows all of it
-- ---------------------------------------------------------------------
-- get_student_dossier() is what the mentor's and the HOD's student page
-- and the student report PDF read. Unchanged from 0031 except:
--   * semester_gpas carry credits and their source,
--   * cgpa_record is the official CGPA, and gpa_stats.cgpa uses it when
--     there is one (cgpa_official says which),
--   * backlogs and black_dots are listed.
CREATE OR REPLACE FUNCTION public.get_student_dossier(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student     public.user_profiles;
  v_can_see_gpa boolean;
  v_cgpa        public.student_cgpas;
  v_report      jsonb;
begin
  select * into v_student from public.user_profiles where id = p_student_id and role = 'student';
  if v_student.id is null then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod OR the student themselves
  if not (public.is_mentor_of(p_student_id) or public.is_hod() or p_student_id = auth.uid()) then
    raise exception 'You are not this student''s mentor' using errcode = '42501';
  end if;

  v_can_see_gpa := public.can_view_student_gpa(p_student_id);
  if v_can_see_gpa then
    select * into v_cgpa from public.student_cgpas where student_id = p_student_id;
  end if;

  select jsonb_build_object(
    'student', jsonb_build_object(
        'id', v_student.id, 'name', v_student.full_name, 'email', v_student.email,
        'registration_no', v_student.login_id, 'section', v_student.section,
        'branch', v_student.branch, 'semester_label', v_student.semester_label,
        'department', v_student.department, 'phone', v_student.phone,
        'is_star_mentee', v_student.is_star_mentee,
        'form_a_completed', v_student.form_a_completed),
    'mentor', (select jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email)
                 from public.user_profiles m where m.id = v_student.assigned_mentor_id),
    'generated_at', now(),

    -- Feature 1 data -------------------------------------------------
    'form_a', (
      -- Only surface a form the student has actually submitted. A row can
      -- exist unsubmitted if they toggled GPA sharing before onboarding.
      select case when f.id is null or not f.is_submitted then null else jsonb_build_object(
        'submitted_at', f.submitted_at,
        'registration_no', f.registration_no, 'roll_no', f.roll_no,
        'date_of_birth', f.date_of_birth, 'blood_group', f.blood_group,
        'mobile_no', f.mobile_no, 'email', f.email,
        'hostel_block', f.hostel_block, 'room_no', f.room_no, 'is_day_scholar', f.is_day_scholar,
        'has_muj_alumni_in_family', f.has_muj_alumni_in_family,
        'alumni', case when f.has_muj_alumni_in_family then jsonb_build_object(
            'name', f.alumni_name, 'branch', f.alumni_branch, 'batch', f.alumni_batch,
            'institution', f.alumni_institution, 'relationship', f.alumni_relationship) end,
        'father', jsonb_build_object('name', f.father_name, 'occupation', f.father_occupation,
            'organization', f.father_organization, 'designation', f.father_designation,
            'mobile', f.father_mobile, 'email', f.father_email),
        'mother', jsonb_build_object('name', f.mother_name, 'occupation', f.mother_occupation,
            'organization', f.mother_organization, 'designation', f.mother_designation,
            'mobile', f.mother_mobile, 'email', f.mother_email),
        'communication_address', f.communication_address,
        'communication_pin_code', f.communication_pin_code,
        'permanent_address', f.permanent_address,
        'permanent_pin_code', f.permanent_pin_code) end
      from public.student_form_a_profiles f where f.student_id = p_student_id),

    -- Feature 2 data, honouring the sharing toggle --------------------
    'gpa_shared', v_can_see_gpa,
    'semester_gpas', case when v_can_see_gpa then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'semester', semester_number, 'gpa', gpa,
                 'earned_credits', earned_credits, 'required_credits', required_credits,
                 'source', source, 'updated_at', updated_at)
                 order by semester_number), '[]'::jsonb)
        from public.student_semester_gpas where student_id = p_student_id)
      else '[]'::jsonb end,
    'cgpa_record', case when v_can_see_gpa and v_cgpa.student_id is not null then jsonb_build_object(
        'cgpa', v_cgpa.cgpa,
        'total_earned_credits', v_cgpa.total_earned_credits,
        'total_required_credits', v_cgpa.total_required_credits,
        'updated_at', v_cgpa.updated_at) end,
    'gpa_stats', case when v_can_see_gpa then (
        select jsonb_build_object(
          'semesters_recorded', count(*),
          -- The published CGPA is credit-weighted. The plain mean of the
          -- semester GPAs is only a stand-in until one has been uploaded.
          'cgpa', coalesce(v_cgpa.cgpa, round(avg(gpa)::numeric, 2), 0),
          'cgpa_official', v_cgpa.cgpa is not null,
          'total_earned_credits', v_cgpa.total_earned_credits,
          'highest', coalesce(max(gpa), 0),
          'lowest',  coalesce(min(gpa), 0),
          'trend',   case when count(*) < 2 then 'insufficient_data'
                          when (select gpa from public.student_semester_gpas
                                 where student_id = p_student_id order by semester_number desc limit 1)
                             > (select gpa from public.student_semester_gpas
                                 where student_id = p_student_id order by semester_number desc offset 1 limit 1)
                          then 'improving' else 'declining' end)
        from public.student_semester_gpas where student_id = p_student_id)
      else null end,

    -- Backlogs, open ones first -----------------------------------------
    'backlogs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'subject_code', subject_code, 'subject_name', subject_name,
               'semester', semester_number, 'grade', grade, 'credits', credits,
               'exam_session', exam_session, 'is_cleared', is_cleared,
               'cleared_at', cleared_at, 'updated_at', updated_at)
               order by is_cleared, semester_number desc nulls last, subject_code), '[]'::jsonb)
      from public.student_backlogs where student_id = p_student_id),

    -- Black dots, most recent incident first ----------------------------
    'black_dots', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'case_number', case_number, 'case_details', case_details,
               'incident_date', incident_date, 'incident_date_text', incident_date_text,
               'hostel_block', hostel_block, 'room_no', room_no,
               'course_branch', course_branch, 'mobile_no', mobile_no,
               'previous_record', previous_record, 'previous_black_dots', previous_black_dots,
               'recorded_at', created_at)
               order by incident_date desc nulls last, created_at desc), '[]'::jsonb)
      from public.student_black_dots where student_id = p_student_id),

    -- Feature 6 data -------------------------------------------------
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'title', title, 'category', category, 'description', description,
               'achieved_on', achieved_on, 'verified', verified_by_faculty,
               'proof_file_path', proof_file_path)
               order by achieved_on desc nulls last), '[]'::jsonb)
      from public.student_achievements where student_id = p_student_id),
    'achievements_by_category', (
      select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb)
      from (select category, count(*) as cnt from public.student_achievements
             where student_id = p_student_id group by category) a),

    -- Query history + Feature 3 outcomes -----------------------------
    'query_summary', (
      select jsonb_build_object(
        'total',            count(*),
        'open',             count(*) filter (where status = 'Open'),
        'in_progress',      count(*) filter (where status = 'In Progress'),
        'resolved',         count(*) filter (where status = 'Resolved'),
        'academic',         count(*) filter (where category = 'Academic'),
        'erp_tech',         count(*) filter (where category = 'ERP/Tech'),
        'infrastructure',   count(*) filter (where category = 'Infrastructure'),
        'confirmed_yes',    count(*) filter (where resolution_status = 'confirmed'),
        'reopened_no',      count(*) filter (where resolution_status = 'reopened'),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                  filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_rating_given', coalesce(round(avg(satisfaction_rating)
                                  filter (where satisfaction_rating is not null)::numeric, 2), 0))
      from public.support_queries where student_id = p_student_id),
    'queries', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'query_code', query_code, 'subject', subject, 'category', category,
               'status', status, 'resolution_status', resolution_status,
               'created_at', created_at, 'resolved_at', resolved_at,
               'satisfaction_rating', satisfaction_rating,
               'confirmation', student_confirmation,
               'confirmation_comment', student_confirmation_comment)
               order by created_at desc), '[]'::jsonb)
      from public.support_queries where student_id = p_student_id),
    'monthly_query_trend', (
      select coalesce(jsonb_agg(jsonb_build_object('month', month, 'count', cnt) order by month), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*) as cnt
              from public.support_queries where student_id = p_student_id
             group by 1) m)
  ) into v_report;

  return v_report;
end;
$function$;
