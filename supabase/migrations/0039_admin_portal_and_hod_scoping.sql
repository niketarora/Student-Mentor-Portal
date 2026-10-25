-- =====================================================================
-- 0039  The administrator portal, and each HOD sees only their faculty
-- =====================================================================
-- Requires 0038 (the 'admin' enum value) to have been applied first.
--
-- THE ADMINISTRATOR
-- ---------------------------------------------------------------------
-- The department now has several HODs. What the single HOD used to see,
-- every faculty member, every student, every query, is now the
-- administrator's view. On top of it the administrator uploads the
-- mentor-HOD mapping: one row per mentor or class coordinator, naming
-- their section and the HOD they report to (map_faculty_to_hods below).
-- Nobody else can change that mapping.
--
-- is_hod() is true for the administrator as well as for a HOD, so every
-- department-level permission (uploads, academic cycles, cycle jobs,
-- roster imports) is the administrator's too without being repeated.
-- is_admin() is true for the administrator only.
--
-- EACH HOD SEES ONLY THE FACULTY MAPPED TO THEM
-- ---------------------------------------------------------------------
-- user_profiles.hod_id names a faculty member's HOD. A HOD sees, and can
-- act on, exactly:
--   * the faculty whose hod_id is theirs;
--   * those faculty members' mentees, and everything about them
--     (attendance, GPA, backlogs, black dots, Form A, achievements,
--     surveys, at-risk flags and meetings);
--   * the queries those faculty members handle, and their MoMs.
-- Reports, the dashboard, reassignment and employment status follow
-- the same scope. Students with no mentor, and faculty the
-- administrator has not mapped yet, are the administrator's to see.
--
-- Three helpers carry the rule, so the policies and functions below
-- read the same way everywhere:
--   my_overseen_faculty()   the caller's faculty, as an array (HOD only)
--   oversees_faculty(id)    the administrator, or that faculty's HOD
--   oversees_student(id)    the administrator, or the HOD of that
--                           student's mentor
-- Policies call my_overseen_faculty() as (select ...), which Postgres
-- evaluates once per query rather than once per row.
--
-- Existing data: a faculty member who had already named their HOD
-- (hod_email, migration 0028) is mapped to that HOD here, so a
-- department with one HOD keeps working before the first upload.
--
-- HODS UPLOAD DATA
-- ---------------------------------------------------------------------
-- The cluster head's upload screens are part of the HOD portal now.
-- A HOD keeps no subject list: an attendance file's course code and
-- name are read from the file, and the subject is created the first
-- time that code is uploaded in the cycle (record_attendance_batch).
-- Cluster heads still upload against the subjects they set up.
--
-- Unchanged: the cluster head portal, the student and faculty portals,
-- and every department-level upload, cycle and job permission. A HOD's
-- view of academic cycles and upload history stays department-wide,
-- the same as a cluster head's.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Who a faculty member reports to
-- ---------------------------------------------------------------------
-- hod_id is the HOD the administrator mapped them to. mentor_section and
-- mentor_designation are the other two columns of the mapping file
-- ("A 3"; "Mentor" or "Class Coordinator (fallback)"), shown next to
-- the faculty member's name. All three are written by the mapping and
-- are protected from the account holder (section 4).
alter table public.user_profiles
  add column if not exists hod_id             uuid references public.user_profiles(id) on delete set null,
  add column if not exists mentor_section     text,
  add column if not exists mentor_designation text;

alter table public.user_profiles
  drop constraint if exists user_profiles_hod_mapping_faculty_only,
  add constraint user_profiles_hod_mapping_faculty_only
    check (role = 'faculty' or (hod_id is null and mentor_section is null and mentor_designation is null)),
  drop constraint if exists user_profiles_hod_not_self,
  add constraint user_profiles_hod_not_self check (hod_id is null or hod_id <> id),
  drop constraint if exists user_profiles_mentor_section_length,
  add constraint user_profiles_mentor_section_length check (mentor_section is null or char_length(mentor_section) <= 40),
  drop constraint if exists user_profiles_mentor_designation_length,
  add constraint user_profiles_mentor_designation_length check (mentor_designation is null or char_length(mentor_designation) <= 80);

create index if not exists user_profiles_hod_idx
  on public.user_profiles (hod_id) where hod_id is not null;

comment on column public.user_profiles.hod_id is
  'The HOD this faculty member reports to. Set by the administrator''s mentor-HOD mapping upload (map_faculty_to_hods), by a HOD creating the account, or once by the faculty member naming their HOD. Decides which HOD sees them and their mentees.';
comment on column public.user_profiles.mentor_section is
  'Section from the mentor-HOD mapping, e.g. "A 3".';
comment on column public.user_profiles.mentor_designation is
  'Role from the mentor-HOD mapping: "Mentor" or "Class Coordinator (fallback)".';

-- Faculty who already named their HOD keep them.
update public.user_profiles f
   set hod_id = h.id
  from public.user_profiles h
 where f.role = 'faculty'
   and f.hod_id is null
   and f.hod_email is not null
   and h.role = 'hod'
   and lower(h.email) = lower(f.hod_email);


-- ---------------------------------------------------------------------
-- 2. Role helpers
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

comment on function public.is_admin() is
  'True for an active administrator: the whole department, and the mentor-HOD mapping.';

-- Department-level permissions (uploads, cycles, jobs, imports) belong
-- to the administrator as well as to every HOD.
create or replace function public.is_hod()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role in ('hod', 'admin') and is_active
  );
$$;

comment on function public.is_hod() is
  'True for an active HOD or the administrator: department-level actions such as uploads, cycles and jobs. Which people a HOD sees is decided by oversees_faculty / oversees_student, not by this.';


-- ---------------------------------------------------------------------
-- 3. Scope helpers
-- ---------------------------------------------------------------------
-- SECURITY DEFINER like every helper that reads user_profiles from
-- inside a user_profiles policy (see 0016): run as the caller, the
-- read would re-enter the same policies.

create or replace function public.my_overseen_faculty()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(f.id), '{}'::uuid[])
    from public.user_profiles f
   where f.hod_id = auth.uid()
     and f.role = 'faculty'
     and exists (
       select 1 from public.user_profiles h
        where h.id = auth.uid() and h.role = 'hod' and h.is_active
     );
$$;

comment on function public.my_overseen_faculty() is
  'The faculty mapped to the calling HOD. Empty for everyone else, including the administrator, who is let through by is_admin() instead.';

create or replace function public.oversees_faculty(p_faculty_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or exists (
        select 1
          from public.user_profiles f
          join public.user_profiles h on h.id = f.hod_id
         where f.id = p_faculty_id
           and f.hod_id = auth.uid()
           and h.role = 'hod' and h.is_active
      );
$$;

comment on function public.oversees_faculty(uuid) is
  'True for the administrator, or for the active HOD this faculty member is mapped to.';

create or replace function public.oversees_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or exists (
        select 1
          from public.user_profiles s
          join public.user_profiles f on f.id = s.assigned_mentor_id
          join public.user_profiles h on h.id = f.hod_id
         where s.id = p_student_id
           and f.hod_id = auth.uid()
           and h.role = 'hod' and h.is_active
      );
$$;

comment on function public.oversees_student(uuid) is
  'True for the administrator, or for the active HOD of this student''s mentor.';

create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select p_student_id = auth.uid()
      or public.is_mentor_of(p_student_id)
      or public.oversees_student(p_student_id);
$function$;

create or replace function public.can_access_query(p_query_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public.support_queries t
    where t.id = p_query_id
      and (
        t.student_id = auth.uid()          -- isStudentOwner
        or t.mentor_id = auth.uid()        -- isAssignedMentor
        or public.oversees_faculty(t.mentor_id)  -- the mentor's HOD, or the administrator
      )
  );
$function$;

create or replace function public.can_view_student_gpa(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    case
      when p_student_id = auth.uid() then true
      when public.oversees_student(p_student_id) then true
      when public.is_mentor_of(p_student_id) then coalesce(
        (select f.gpa_sharing_enabled
           from public.student_form_a_profiles f
          where f.student_id = p_student_id),
        true)
      else false
    end;
$function$;


-- ---------------------------------------------------------------------
-- 4. Protected profile columns, and new accounts
-- ---------------------------------------------------------------------
-- The administrator (like the service role and trusted functions) may
-- change anything. A HOD may still manage the people they can update,
-- but cannot grant or remove the HOD or administrator role, and nobody
-- but the administrator changes the mentor-HOD mapping.
create or replace function public.guard_protected_profile_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (auth.uid() is null)
     or coalesce(current_setting('ssmp.trusted_operation', true), 'off') = 'on'
     or public.is_admin() then
    return new;
  end if;

  if new.hod_id is distinct from old.hod_id
     or new.mentor_section is distinct from old.mentor_section
     or new.mentor_designation is distinct from old.mentor_designation
     or (old.hod_id is not null and new.hod_email is distinct from old.hod_email) then
    raise exception 'Not permitted: the mentor-HOD mapping is managed by the administrator'
      using errcode = '42501';
  end if;

  if public.is_hod() then
    if new.role is distinct from old.role
       and (new.role in ('hod', 'admin') or old.role in ('hod', 'admin')) then
      raise exception 'Not permitted: only the administrator can grant or remove the HOD or administrator role'
        using errcode = '42501';
    end if;
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

-- An administrator account can only come from the service role, the
-- one caller able to set app_metadata. A self sign-up asking for
-- 'admin' in user_metadata becomes a student, like any unknown role.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  meta            jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role  text  := coalesce(meta ->> 'role', 'student');
  resolved_role   public.user_role;
begin
  -- Only accept a non-student role if it is one we recognise. The
  -- administrator also needs app_metadata, which only the service role sets.
  if requested_role = 'admin' then
    resolved_role := case when coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin'
                          then 'admin' else 'student' end;
  elsif requested_role in ('student', 'faculty', 'hod', 'cluster_head') then
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
$function$;


-- ---------------------------------------------------------------------
-- 5. Row-level security
-- ---------------------------------------------------------------------
-- Policies that gave the HOD every row now give the administrator every
-- row and a HOD the rows of their own faculty. The department-level
-- ones (upload batches, subjects, cycles, job runs, roster imports,
-- semester cycles, canned replies) keep is_hod() and are not touched.

-- user_profiles ---------------------------------------------------------
drop policy if exists profiles_select_hod_all on public.user_profiles;
drop policy if exists profiles_select_hod_scope on public.user_profiles;
create policy profiles_select_hod_scope on public.user_profiles
  for select to authenticated
  using (
    (select public.is_admin())
    or id = any((select public.my_overseen_faculty())::uuid[])
    or assigned_mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

-- The people behind uploads and mappings: a HOD sees the names of the
-- other HODs, the cluster heads and the administrator (upload history,
-- "uploaded by"), never their mentees.
drop policy if exists profiles_select_staff_directory on public.user_profiles;
create policy profiles_select_staff_directory on public.user_profiles
  for select to authenticated
  using (role in ('hod', 'cluster_head', 'admin') and (select public.is_hod()));

-- Faculty still see every colleague (reserve pool, reassignment
-- targets); the HOD now sees theirs through profiles_select_hod_scope.
drop policy if exists profiles_select_faculty_roster on public.user_profiles;
create policy profiles_select_faculty_roster on public.user_profiles
  for select to authenticated
  using (role = 'faculty' and ((select public.is_faculty()) or (select public.is_admin())));

drop policy if exists profiles_update_hod on public.user_profiles;
create policy profiles_update_hod on public.user_profiles
  for update to authenticated
  using (
    (select public.is_admin())
    or id = any((select public.my_overseen_faculty())::uuid[])
    or assigned_mentor_id = any((select public.my_overseen_faculty())::uuid[])
  )
  with check (
    (select public.is_admin())
    or id = any((select public.my_overseen_faculty())::uuid[])
    or assigned_mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

-- support_queries --------------------------------------------------------
drop policy if exists queries_select_participants on public.support_queries;
create policy queries_select_participants on public.support_queries
  for select to authenticated
  using (
    student_id = auth.uid()
    or mentor_id = auth.uid()
    or (select public.is_admin())
    or mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

drop policy if exists queries_update_hod on public.support_queries;
create policy queries_update_hod on public.support_queries
  for update to authenticated
  using ((select public.is_admin()) or mentor_id = any((select public.my_overseen_faculty())::uuid[]))
  with check ((select public.is_admin()) or mentor_id = any((select public.my_overseen_faculty())::uuid[]));

-- at_risk_meetings -------------------------------------------------------
drop policy if exists meetings_select_visible on public.at_risk_meetings;
create policy meetings_select_visible on public.at_risk_meetings
  for select to authenticated
  using (
    student_id = auth.uid()
    or mentor_id = auth.uid()
    or (select public.is_admin())
    or mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

drop policy if exists meetings_update_mentor on public.at_risk_meetings;
create policy meetings_update_mentor on public.at_risk_meetings
  for update to authenticated
  using (
    mentor_id = auth.uid()
    or (select public.is_admin())
    or mentor_id = any((select public.my_overseen_faculty())::uuid[])
  )
  with check (
    mentor_id = auth.uid()
    or (select public.is_admin())
    or mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

-- mom_records ------------------------------------------------------------
drop policy if exists mom_select_participants on public.mom_records;
create policy mom_select_participants on public.mom_records
  for select to authenticated
  using (
    reported_by = auth.uid()
    or mentor_id = auth.uid()
    or (select public.is_admin())
    or mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

-- mentor_reassignment_log ------------------------------------------------
drop policy if exists reassignment_log_hod_select on public.mentor_reassignment_log;
create policy reassignment_log_hod_select on public.mentor_reassignment_log
  for select to authenticated
  using (
    (select public.is_admin())
    or from_mentor_id = any((select public.my_overseen_faculty())::uuid[])
    or to_mentor_id = any((select public.my_overseen_faculty())::uuid[])
  );

-- student_form_a_profiles ------------------------------------------------
drop policy if exists form_a_update_hod on public.student_form_a_profiles;
create policy form_a_update_hod on public.student_form_a_profiles
  for update to authenticated
  using (public.oversees_student(student_id))
  with check (public.oversees_student(student_id));

-- audit_log: the whole department's trail is the administrator's ---------
drop policy if exists audit_log_hod_select on public.audit_log;
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated
  using ((select public.is_admin()));


-- ---------------------------------------------------------------------
-- 6. Functions that acted for "the HOD" now ask "this person's HOD"
-- ---------------------------------------------------------------------
-- The bodies are unchanged apart from the authorization check (and, in
-- post_query_message, counting the administrator as staff).

create or replace function public.get_student_dossier(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
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

  -- isAssignedMentor OR their mentor's HOD (or the administrator) OR the student themselves
  if not (public.is_mentor_of(p_student_id) or public.oversees_student(p_student_id) or p_student_id = auth.uid()) then
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

create or replace function public.get_faculty_activity_report(p_faculty_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_faculty_id uuid := coalesce(p_faculty_id, auth.uid());
  v_from       timestamptz := coalesce(p_from, (current_date - interval '90 days')::date)::timestamptz;
  v_to         timestamptz := (coalesce(p_to, current_date) + interval '1 day')::timestamptz;
  v_faculty    public.user_profiles;
  v_report     jsonb;
begin
  -- self OR this faculty member's HOD (or the administrator)
  if v_faculty_id <> auth.uid() and not public.oversees_faculty(v_faculty_id) then
    raise exception 'You can only generate a report for your own activity' using errcode = '42501';
  end if;

  select * into v_faculty from public.user_profiles where id = v_faculty_id and role = 'faculty';
  if v_faculty.id is null then
    raise exception 'Faculty member not found' using errcode = 'P0002';
  end if;
  if v_to <= v_from then
    raise exception 'The "to" date must be after the "from" date' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'faculty', jsonb_build_object(
        'id', v_faculty.id, 'name', v_faculty.full_name, 'email', v_faculty.email,
        'login_id', v_faculty.login_id, 'branch', v_faculty.branch,
        'department', v_faculty.department, 'employment_status', v_faculty.employment_status),
    'period', jsonb_build_object('from', v_from::date, 'to', (v_to - interval '1 day')::date),
    'generated_at', now(),

    -- headline numbers -------------------------------------------------
    'summary', (
      select jsonb_build_object(
        'total_queries',        count(*),
        'open_queries',         count(*) filter (where status = 'Open'),
        'in_progress_queries',  count(*) filter (where status = 'In Progress'),
        'resolved_queries',     count(*) filter (where status = 'Resolved'),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction',     coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'rated_queries',        count(*) filter (where satisfaction_rating is not null),
        'escalated_queries',    count(*) filter (where escalated_to_hod),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_queries
      where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to),

    -- bar / donut chart: category mix ---------------------------------
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category, 'total', total,
               'resolved', resolved, 'open', open_count) order by category), '[]'::jsonb)
      from (
        select category,
               count(*)                                  as total,
               count(*) filter (where status = 'Resolved') as resolved,
               count(*) filter (where status <> 'Resolved') as open_count
        from public.support_queries
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by category) c),

    -- stacked bar chart: status mix -----------------------------------
    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'total', total) order by status), '[]'::jsonb)
      from (select status, count(*) as total
              from public.support_queries
             where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
             group by status) s),

    -- donut chart: Feature 3 confirmation outcomes --------------------
    'resolution_confirmation', (
      select jsonb_build_object(
        'confirmed_yes',        count(*) filter (where resolution_status = 'confirmed'),
        'reopened_no',          count(*) filter (where resolution_status = 'reopened'),
        'awaiting_response',    count(*) filter (where resolution_status = 'pending_confirmation'),
        'never_resolved',       count(*) filter (where resolution_status = 'none'))
      from public.support_queries
      where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to),

    -- line chart: weekly volume ---------------------------------------
    'weekly_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start', week_start, 'created', created_count, 'resolved', resolved_count)
               order by week_start), '[]'::jsonb)
      from (
        select date_trunc('week', created_at)::date              as week_start,
               count(*)                                          as created_count,
               count(*) filter (where status = 'Resolved')       as resolved_count
        from public.support_queries
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by 1) w),

    -- bar chart: satisfaction histogram -------------------------------
    'rating_distribution', (
      select coalesce(jsonb_object_agg(rating::text, cnt), '{}'::jsonb)
      from (select satisfaction_rating as rating, count(*) as cnt
              from public.support_queries
             where mentor_id = v_faculty_id and satisfaction_rating is not null
               and created_at >= v_from and created_at < v_to
             group by satisfaction_rating) r),

    -- table: mentee roster --------------------------------------------
    'mentees', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.full_name, 'registration_no', s.login_id,
               'section', s.section, 'branch', s.branch, 'email', s.email,
               'is_star_mentee', s.is_star_mentee,
               'form_a_completed', s.form_a_completed,
               'query_count', (select count(*) from public.support_queries t
                                 where t.student_id = s.id and t.mentor_id = v_faculty_id))
               order by s.full_name), '[]'::jsonb)
      from public.user_profiles s
      where s.assigned_mentor_id = v_faculty_id and s.role = 'student')
  ) into v_report;

  return v_report;
end;
$function$;

create or replace function public.post_query_message(p_query_id uuid, p_body text)
returns query_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_query   public.support_queries;
  v_role     public.user_role;
  v_message  public.query_messages;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_non_blank(p_body) then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 5000 then
    raise exception 'Message must be 5000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isStudentOwner / isAssignedMentor / the mentor's HOD (or the administrator)
  if not (v_query.student_id = auth.uid()
          or v_query.mentor_id = auth.uid()
          or public.oversees_faculty(v_query.mentor_id)) then
    raise exception 'Unauthorized to post on this query' using errcode = '42501';
  end if;

  select role into v_role from public.user_profiles where id = auth.uid();

  insert into public.query_messages (query_id, sender_id, body)
  values (p_query_id, auth.uid(), btrim(p_body))
  returning * into v_message;

  update public.support_queries
     set last_message_at   = now(),
         first_response_at = case
                               when first_response_at is null and v_role in ('faculty','hod','admin')
                               then now() else first_response_at
                             end,
         status            = case
                               when v_role in ('faculty','hod','admin') and status = 'Open'
                               then 'In Progress'::public.query_status else status
                             end
   where id = p_query_id;

  return v_message;
end;
$function$;

create or replace function public.resolve_support_query(p_query_id uuid, p_note text DEFAULT NULL::text)
returns support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_query public.support_queries;
  v_name   text;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod (students may not resolve their own query;
  -- they answer the confirmation prompt instead)
  if not (v_query.mentor_id = auth.uid() or public.oversees_faculty(v_query.mentor_id)) then
    raise exception 'Only the assigned mentor or the HOD can resolve this query'
      using errcode = '42501';
  end if;
  if v_query.status = 'Resolved' and v_query.resolution_status = 'confirmed' then
    raise exception 'This query is already closed and confirmed' using errcode = '22023';
  end if;

  select full_name into v_name from public.user_profiles where id = auth.uid();

  update public.support_queries
     set status            = 'Resolved',
         resolution_status = 'pending_confirmation',
         resolved_by       = auth.uid(),
         resolved_at       = now(),
         last_message_at   = now()
   where id = p_query_id
   returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (
    p_query_id, auth.uid(),
    coalesce(nullif(btrim(p_note), ''),
             format('Marked as resolved by %s. Awaiting student confirmation.', v_name)),
    true
  );

  return v_query;
end;
$function$;

create or replace function public.set_query_in_progress(p_query_id uuid)
returns support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_query public.support_queries;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;
  if not (v_query.mentor_id = auth.uid() or public.oversees_faculty(v_query.mentor_id)) then
    raise exception 'Only the assigned mentor or the HOD can pick this up' using errcode = '42501';
  end if;
  if v_query.status = 'Resolved' and v_query.resolution_status = 'confirmed' then
    raise exception 'This query is already closed and confirmed' using errcode = '22023';
  end if;

  update public.support_queries
     set status            = 'In Progress',
         resolution_status = 'none',
         first_response_at = coalesce(first_response_at, now()),
         last_message_at   = now()
   where id = p_query_id
  returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (p_query_id, auth.uid(), 'Picked up — marked as In Progress.', true);

  return v_query;
end;
$function$;

create or replace function public.set_achievement_verification(p_achievement_id uuid, p_verified boolean)
returns student_achievements
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.student_achievements;
begin
  select * into v_row from public.student_achievements where id = p_achievement_id;
  if v_row.id is null then
    raise exception 'Achievement not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod
  if not (public.is_mentor_of(v_row.student_id) or public.oversees_student(v_row.student_id)) then
    raise exception 'Only the assigned mentor or the HOD can verify this achievement'
      using errcode = '42501';
  end if;

  update public.student_achievements
     set verified_by_faculty = p_verified,
         verified_by         = case when p_verified then auth.uid() else null end,
         verified_at         = case when p_verified then now() else null end
   where id = p_achievement_id
   returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.set_at_risk_meeting_status(p_meeting_id uuid, p_status at_risk_meeting_status)
returns at_risk_meetings
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_meeting public.at_risk_meetings;
begin
  select * into v_meeting from public.at_risk_meetings where id = p_meeting_id;
  if v_meeting.id is null then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if not (v_meeting.mentor_id = auth.uid() or public.oversees_faculty(v_meeting.mentor_id)) then
    raise exception 'Only the organising mentor or the HOD can update this meeting'
      using errcode = '42501';
  end if;

  update public.at_risk_meetings
     set status       = p_status,
         completed_at = case when p_status = 'completed' then now() else completed_at end,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
   where id = p_meeting_id
  returning * into v_meeting;

  return v_meeting;
end;
$function$;

create or replace function public.create_at_risk_meeting_link(p_meeting_id uuid)
returns at_risk_meetings
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_meeting public.at_risk_meetings;
begin
  select * into v_meeting from public.at_risk_meetings where id = p_meeting_id;
  if v_meeting.id is null then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if not (v_meeting.mentor_id = auth.uid() or public.oversees_faculty(v_meeting.mentor_id) or auth.uid() is null) then
    raise exception 'Only the organising mentor or the HOD can generate this link'
      using errcode = '42501';
  end if;

  -- TODO(provider): create the meeting with the mentor as organiser and
  -- set meeting_provider, meeting_join_url, meeting_external_id,
  -- scheduled_for and status = 'scheduled'. Returning the row unchanged is
  -- the correct behaviour today.
  return v_meeting;
end;
$function$;

create or replace function public.set_star_mentee(p_student_id uuid, p_is_star boolean)
returns user_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_student public.user_profiles;
  v_mentor  uuid;
begin
  select * into v_student from public.user_profiles where id = p_student_id;
  if v_student.id is null or v_student.role <> 'student' then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod
  if public.is_mentor_of(p_student_id) then
    v_mentor := auth.uid();
  elsif public.oversees_student(p_student_id) then
    v_mentor := v_student.assigned_mentor_id;
    if v_mentor is null then
      raise exception 'This student has no assigned mentor yet' using errcode = '22023';
    end if;
  else
    raise exception 'Only the assigned mentor or the HOD can set a star mentee'
      using errcode = '42501';
  end if;

  -- Serialise on the mentor row so two concurrent calls cannot both win.
  perform 1 from public.user_profiles where id = v_mentor for update;

  -- is_star_mentee is a protected column; this function has already
  -- verified the caller is the assigned mentor or the HOD.
  perform set_config('ssmp.trusted_operation', 'on', true);

  if p_is_star then
    update public.user_profiles
       set is_star_mentee = false,
           star_mentee_assigned_by = null,
           star_mentee_assigned_at = null
     where assigned_mentor_id = v_mentor
       and is_star_mentee = true
       and id <> p_student_id;

    update public.user_profiles
       set is_star_mentee = true,
           star_mentee_assigned_by = auth.uid(),
           star_mentee_assigned_at = now()
     where id = p_student_id
     returning * into v_student;
  else
    update public.user_profiles
       set is_star_mentee = false,
           star_mentee_assigned_by = null,
           star_mentee_assigned_at = null
     where id = p_student_id
     returning * into v_student;
  end if;

  perform set_config('ssmp.trusted_operation', 'off', true);

  return v_student;
end;
$function$;

create or replace function public.unlock_student_form_a(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.oversees_student(p_student_id) then
    raise exception 'Only this student''s HOD can unlock a submitted Form A' using errcode = '42501';
  end if;

  update public.student_form_a_profiles
     set is_locked = false, unlock_requested = false, unlocked_by = auth.uid()
   where student_id = p_student_id;

  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set form_a_completed = false, form_a_completed_at = null
   where id = p_student_id;
  perform set_config('ssmp.trusted_operation', 'off', true);

end;
$function$;

-- Both ends of a reassignment must be the caller's: the students, and
-- the faculty member they move to.
create or replace function public.reassign_mentees(p_student_ids uuid[], p_to_mentor_id uuid, p_reason text DEFAULT NULL::text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_target public.user_profiles;
  v_count  integer;
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can reassign mentees' using errcode = '42501';
  end if;
  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'Select at least one student to reassign' using errcode = '22023';
  end if;
  if array_length(p_student_ids, 1) > 500 then
    raise exception 'Reassign at most 500 students at a time' using errcode = '22023';
  end if;

  select * into v_target from public.user_profiles where id = p_to_mentor_id;
  if v_target.id is null or v_target.role <> 'faculty' then
    raise exception 'Target mentor not found' using errcode = 'P0002';
  end if;
  if v_target.employment_status <> 'active' then
    raise exception 'Cannot reassign students to a mentor whose status is %', v_target.employment_status
      using errcode = '22023';
  end if;

  if not public.oversees_faculty(p_to_mentor_id) then
    raise exception 'You can only move students to a faculty member who reports to you' using errcode = '42501';
  end if;
  if not public.is_admin() and exists (
       select 1 from unnest(p_student_ids) as s(id) where not public.oversees_student(s.id)) then
    raise exception 'Some of these students are not mentored by a faculty member who reports to you' using errcode = '42501';
  end if;

  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set assigned_mentor_id = p_to_mentor_id
   where id = any(p_student_ids)
     and role = 'student'
     and assigned_mentor_id is distinct from p_to_mentor_id;

  get diagnostics v_count = row_count;
  perform set_config('ssmp.trusted_operation', 'off', true);


  if p_reason is not null then
    update public.mentor_reassignment_log
       set reason = p_reason
     where student_id = any(p_student_ids)
       and to_mentor_id = p_to_mentor_id
       and created_at > now() - interval '10 seconds';
  end if;

  return v_count;
end;
$function$;

create or replace function public.set_faculty_employment_status(p_faculty_id uuid, p_status employment_status, p_available boolean DEFAULT NULL::boolean)
returns user_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.user_profiles;
begin
  if not public.oversees_faculty(p_faculty_id) then
    raise exception 'Only this faculty member''s HOD can change their employment status' using errcode = '42501';
  end if;

  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set employment_status = p_status,
         available_for_reassignment = case
           when p_available is not null then p_available
           when p_status <> 'active' then false
           else available_for_reassignment end
   where id = p_faculty_id and role = 'faculty'
   returning * into v_row;
  perform set_config('ssmp.trusted_operation', 'off', true);

  if v_row.id is null then
    raise exception 'Faculty member not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;


-- ---------------------------------------------------------------------
-- 7. Dashboard and the all-faculty report
-- ---------------------------------------------------------------------
-- The administrator gets the department-wide figures the HOD used to
-- get; a HOD gets the same figures for their own faculty and mentees.
-- A cluster head's figures are unchanged.
create or replace function public.get_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      public.user_profiles;
  v_result  jsonb;
  v_scoped  boolean;
  v_faculty uuid[];
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_me.role = 'student' then
    select jsonb_build_object(
      'role', 'student',
      'total_queries',        count(*),
      'open_queries',         count(*) filter (where status = 'Open'),
      'in_progress_queries',  count(*) filter (where status = 'In Progress'),
      'resolved_queries',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'unrated_resolved',     count(*) filter (where status = 'Resolved' and satisfaction_rating is null),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1)
    ) into v_result
    from public.support_queries where student_id = v_me.id;

    v_result := v_result || jsonb_build_object(
      'form_a_completed',  v_me.form_a_completed,
      'is_star_mentee',    v_me.is_star_mentee,
      'achievements_count',(select count(*) from public.student_achievements where student_id = v_me.id),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );

  elsif v_me.role = 'faculty' then
    select jsonb_build_object(
      'role', 'faculty',
      'total_queries',        count(*),
      'open_queries',         count(*) filter (where status = 'Open'),
      'in_progress_queries',  count(*) filter (where status = 'In Progress'),
      'resolved_queries',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'reopened_queries',     count(*) filter (where resolution_status = 'reopened'),
      'avg_first_response_hours', round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                        filter (where first_response_at is not null)::numeric, 1),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1),
      'avg_satisfaction',     round(avg(satisfaction_rating)
                                    filter (where satisfaction_rating is not null)::numeric, 2),
      'resolved_this_week',   count(*) filter (where resolved_at >= date_trunc('week', now())),
      'resolved_last_week',   count(*) filter (where resolved_at >= date_trunc('week', now()) - interval '7 days'
                                                and resolved_at <  date_trunc('week', now()))
    ) into v_result
    from public.support_queries where mentor_id = v_me.id;

    v_result := v_result || jsonb_build_object(
      'mentee_count',
        (select count(*) from public.user_profiles where assigned_mentor_id = v_me.id and role = 'student'),
      'onboarding_pending',
        (select count(*) from public.user_profiles
          where assigned_mentor_id = v_me.id and role = 'student' and form_a_completed = false),
      'star_mentee',
        (select jsonb_build_object('id', id, 'name', full_name)
           from public.user_profiles
          where assigned_mentor_id = v_me.id and is_star_mentee limit 1),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );

  else  -- hod (their faculty), admin and cluster head (the department)
    v_scoped  := v_me.role = 'hod';
    v_faculty := case when v_scoped then public.my_overseen_faculty() end;

    select jsonb_build_object(
      'role', case when v_me.role = 'admin' then 'admin' else 'hod' end,
      'total_queries',        count(*),
      'open_queries',         count(*) filter (where status = 'Open'),
      'in_progress_queries',  count(*) filter (where status = 'In Progress'),
      'resolved_queries',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'reopened_queries',     count(*) filter (where resolution_status = 'reopened'),
      'avg_first_response_hours', round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                        filter (where first_response_at is not null)::numeric, 1),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1),
      'avg_satisfaction',     round(avg(satisfaction_rating)
                                    filter (where satisfaction_rating is not null)::numeric, 2),
      'academic_queries',     count(*) filter (where category = 'Academic'),
      'erp_tech_queries',     count(*) filter (where category = 'ERP/Tech'),
      'infrastructure_queries', count(*) filter (where category = 'Infrastructure')
    ) into v_result
    from public.support_queries
    where not v_scoped or mentor_id = any(v_faculty);

    v_result := v_result || jsonb_build_object(
      'coverage', case when v_scoped then 'hod' else 'department' end,
      'total_students', (select count(*) from public.user_profiles
                          where role = 'student' and (not v_scoped or assigned_mentor_id = any(v_faculty))),
      'total_faculty',  (select count(*) from public.user_profiles
                          where role = 'faculty' and (not v_scoped or id = any(v_faculty))),
      'active_faculty', (select count(*) from public.user_profiles
                          where role = 'faculty' and employment_status = 'active'
                            and (not v_scoped or id = any(v_faculty))),
      'departed_faculty', (select count(*) from public.user_profiles
                            where role = 'faculty' and employment_status = 'departed'
                              and (not v_scoped or id = any(v_faculty))),
      -- A HOD's students all have a mentor, by definition of the scope.
      'unassigned_students', case when v_scoped then 0 else
                               (select count(*) from public.user_profiles
                                 where role = 'student' and assigned_mentor_id is null) end,
      'onboarding_pending', (select count(*) from public.user_profiles
                              where role = 'student' and form_a_completed = false
                                and (not v_scoped or assigned_mentor_id = any(v_faculty))),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );
  end if;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.get_department_faculty_report(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_from   timestamptz := coalesce(p_from, (current_date - interval '90 days')::date)::timestamptz;
  v_to     timestamptz := (coalesce(p_to, current_date) + interval '1 day')::timestamptz;
  v_report jsonb;
  v_scoped  boolean;
  v_faculty uuid[];
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can generate a department-wide report' using errcode = '42501';
  end if;
  -- The administrator reports on the department; a HOD on the faculty
  -- mapped to them (0039).
  v_scoped  := not public.is_admin();
  v_faculty := public.my_overseen_faculty();

  if v_to <= v_from then
    raise exception 'The "to" date must be after the "from" date' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'scope', 'department',
    -- Whose faculty the report covers: the department, or one HOD's.
    'coverage', case when v_scoped then 'hod' else 'department' end,
    'hod_name', case when v_scoped then (select full_name from public.user_profiles where id = auth.uid()) end,
    'department', coalesce((select department from public.user_profiles where id = auth.uid()), 'IoT & IS'),
    'period', jsonb_build_object('from', v_from::date, 'to', (v_to - interval '1 day')::date),
    'generated_at', now(),

    -- headline numbers across the whole department -------------------
    'summary', (
      select jsonb_build_object(
        'faculty_count',   (select count(*) from public.user_profiles where role = 'faculty' and (not v_scoped or id = any(v_faculty))),
        'active_faculty',  (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'active' and (not v_scoped or id = any(v_faculty))),
        'student_count',   (select count(*) from public.user_profiles where role = 'student' and (not v_scoped or assigned_mentor_id = any(v_faculty))),
        'unassigned_students', (select count(*) from public.user_profiles where role = 'student' and assigned_mentor_id is null and not v_scoped),
        'total_queries',   count(*),
        'open_queries',    count(*) filter (where status = 'Open'),
        'in_progress_queries', count(*) filter (where status = 'In Progress'),
        'resolved_queries',count(*) filter (where status = 'Resolved'),
        'escalated_queries', count(*) filter (where escalated_to_hod),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction', coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_queries
      where created_at >= v_from and created_at < v_to and (not v_scoped or mentor_id = any(v_faculty))),

    -- department-wide category mix (chart) ----------------------------
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category, 'total', total, 'resolved', resolved) order by category), '[]'::jsonb)
      from (select category, count(*) as total, count(*) filter (where status = 'Resolved') as resolved
              from public.support_queries
             where created_at >= v_from and created_at < v_to and (not v_scoped or mentor_id = any(v_faculty))
             group by category) c),

    -- department-wide status mix (chart) ------------------------------
    'by_status', (
      select jsonb_build_object(
        'open',        count(*) filter (where status = 'Open'),
        'in_progress', count(*) filter (where status = 'In Progress'),
        'resolved',    count(*) filter (where status = 'Resolved'))
      from public.support_queries
      where created_at >= v_from and created_at < v_to and (not v_scoped or mentor_id = any(v_faculty))),

    -- monthly volume (chart) ------------------------------------------
    'monthly_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', month, 'created', created_count, 'resolved', resolved_count) order by month), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'Mon YY') as month,
                   date_trunc('month', created_at)                    as sort_key,
                   count(*)                                           as created_count,
                   count(*) filter (where status = 'Resolved')        as resolved_count
              from public.support_queries
             where created_at >= v_from and created_at < v_to and (not v_scoped or mentor_id = any(v_faculty))
             group by 1, 2 order by 2) m),

    -- one row per faculty member (the tabular half) --------------------
    'faculty', (
      select coalesce(jsonb_agg(row order by (row ->> 'resolved_queries')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', f.id,
          'name', f.full_name,
          'login_id', f.login_id,
          'branch', f.branch,
          'employment_status', f.employment_status,
          'mentee_count', (select count(*) from public.user_profiles s
                            where s.assigned_mentor_id = f.id and s.role = 'student'),
          'total_queries',    count(t.id),
          'open_queries',     count(t.id) filter (where t.status = 'Open'),
          'in_progress_queries', count(t.id) filter (where t.status = 'In Progress'),
          'resolved_queries', count(t.id) filter (where t.status = 'Resolved'),
          'reopened',         count(t.id) filter (where t.resolution_status = 'reopened'),
          'confirmed',        count(t.id) filter (where t.resolution_status = 'confirmed'),
          'avg_first_response_hours', coalesce(round(avg(extract(epoch from (t.first_response_at - t.created_at))/3600.0)
                                       filter (where t.first_response_at is not null)::numeric, 1), 0),
          'avg_resolution_hours', coalesce(round(avg(extract(epoch from (t.resolved_at - t.created_at))/3600.0)
                                       filter (where t.resolved_at is not null)::numeric, 1), 0),
          'avg_satisfaction', coalesce(round(avg(t.satisfaction_rating)
                                       filter (where t.satisfaction_rating is not null)::numeric, 2), 0),
          'resolution_rate_percent',
              case when count(t.id) = 0 then 0
                   else round(100.0 * count(t.id) filter (where t.status = 'Resolved') / count(t.id), 1) end
        ) as row
        from public.user_profiles f
        left join public.support_queries t
               on t.mentor_id = f.id and t.created_at >= v_from and t.created_at < v_to
        where f.role = 'faculty' and (not v_scoped or f.id = any(v_faculty))
        group by f.id
      ) rows)
  ) into v_report;

  return v_report;
end;
$function$;


-- ---------------------------------------------------------------------
-- 8. Referring a query: to the mentor's HOD, else the administrator
-- ---------------------------------------------------------------------
-- The referral goes to the HOD the query's mentor is mapped to. With
-- no mapping (or that HOD deactivated) it goes to the administrator,
-- who sees every query. It no longer goes to every HOD: since this
-- migration a HOD cannot open a query outside their own faculty.
create or replace function public.escalate_query_to_hod(p_query_id uuid, p_note text default null)
returns public.support_queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query   public.support_queries;
  v_caller  public.user_profiles;
  v_owner   public.user_profiles;
  v_student text;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_title   text;
  v_body    text;
  v_to      record;
  v_sent    integer := 0;
begin
  select * into v_query from public.support_queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR this mentor's HOD (or the administrator)
  if not (v_query.mentor_id = auth.uid() or public.oversees_faculty(v_query.mentor_id)) then
    raise exception 'Only the assigned mentor can refer this query to the HOD'
      using errcode = '42501';
  end if;
  if v_query.escalated_to_hod then
    raise exception 'This query has already been referred to the HOD' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note must be 1000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_caller from public.user_profiles where id = auth.uid();
  select * into v_owner  from public.user_profiles where id = v_query.mentor_id;
  select full_name into v_student from public.user_profiles where id = v_query.student_id;

  update public.support_queries
     set escalated_to_hod = true,
         escalated_at     = now(),
         escalated_by     = auth.uid(),
         escalation_note  = v_note,
         last_message_at  = now()
   where id = p_query_id
   returning * into v_query;

  insert into public.query_messages (query_id, sender_id, body, is_system_message)
  values (
    p_query_id, auth.uid(),
    format('%s referred this query to the HOD.%s',
           coalesce(v_caller.full_name, 'The mentor'),
           case when v_note is null then '' else ' Note: ' || v_note end),
    true
  );

  v_title := format('%s referred %s to you', coalesce(v_caller.full_name, 'A mentor'), v_query.query_code);
  v_body  := format('%s — %s', coalesce(v_student, 'A student'),
                    coalesce(v_note, 'The mentor has asked you to look at this query.'));

  -- The HOD this mentor is mapped to.
  for v_to in
    select id from public.user_profiles
     where id = v_owner.hod_id and role = 'hod' and is_active
  loop
    perform public.enqueue_notification(
      v_to.id, auth.uid(), 'query_escalated', v_title, v_body,
      v_query.id, '/hod/queries/' || v_query.id::text
    );
    v_sent := v_sent + 1;
  end loop;

  -- Not mapped: the administrator.
  if v_sent = 0 then
    for v_to in select id from public.user_profiles where role = 'admin' and is_active loop
      perform public.enqueue_notification(
        v_to.id, auth.uid(), 'query_escalated', v_title, v_body,
        v_query.id, '/admin/queries/' || v_query.id::text
      );
    end loop;
  end if;

  -- The student is told too, so the referral is never a surprise.
  perform public.enqueue_notification(
    v_query.student_id, auth.uid(), 'query_escalated',
    format('%s has been referred to the HOD', v_query.query_code),
    'Your mentor has asked the Head of Department to look at this. They will be in touch.',
    v_query.id, '/student/queries/' || v_query.id::text
  );

  return v_query;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. A mentor naming their own HOD
-- ---------------------------------------------------------------------
-- Once a mentor is mapped, their HOD is the mapped one: the form shows
-- it and a different address is refused. A mentor nobody has mapped
-- yet may still name their HOD, which maps them to that HOD, the same
-- as the existing data was mapped in section 1. Changing it afterwards
-- is the administrator's (the mapping upload).
create or replace function public.set_mentor_department_and_hod(p_department text, p_hod_email text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     public.user_profiles;
  v_dept   text := btrim(coalesce(p_department, ''));
  v_email  text := lower(btrim(coalesce(p_hod_email, '')));
  v_hod    public.user_profiles;
  v_count  integer;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'faculty' then
    raise exception 'Only a faculty mentor can set this' using errcode = '42501';
  end if;

  if not public.is_non_blank(v_dept) then
    raise exception 'Enter a department' using errcode = '22023';
  end if;
  if char_length(v_dept) > 120 then
    raise exception 'Department must be 120 characters or fewer' using errcode = '22023';
  end if;

  if v_me.hod_id is not null then
    select * into v_hod from public.user_profiles where id = v_me.hod_id;
    if v_email <> '' and v_email <> lower(v_hod.email) then
      raise exception 'Your HOD is % (%), from the department''s mentor-HOD mapping. Ask the administrator if that is wrong.',
        v_hod.full_name, v_hod.email
        using errcode = '22023';
    end if;
  else
    -- Checked here, not at escalation time: a typo should be rejected
    -- while the mentor is looking at the form.
    if v_email = '' then
      raise exception 'Enter your HOD''s email address' using errcode = '22023';
    end if;
    select * into v_hod
      from public.user_profiles
     where lower(email) = v_email and role = 'hod' and is_active;
    if v_hod.id is null then
      raise exception 'No active HOD account has the email %. Check the address with your department office.', v_email
        using errcode = '22023';
    end if;
  end if;

  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set department = v_dept,
         hod_email  = v_hod.email,
         hod_id     = v_hod.id
   where id = v_me.id;
  perform set_config('ssmp.trusted_operation', 'off', true);

  update public.user_profiles
     set department = v_dept
   where assigned_mentor_id = v_me.id
     and role = 'student'
     and department is distinct from v_dept;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. HOD uploads: the subject comes from the attendance file
-- ---------------------------------------------------------------------
-- The caller's own subject is preferred when more than one account has
-- the same code this cycle. A HOD (or the administrator) with no
-- subject for the code gets one created from the file's header; a
-- cluster head still has to add it under My Subjects first. The
-- result says whether a subject was created.
create or replace function public.record_attendance_batch(p_course_code text, p_course_name text, p_section text, p_period_start date, p_period_end date, p_filename text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
  v_created   boolean := false;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload attendance' using errcode = '42501';
  end if;
  if p_course_code is null or btrim(p_course_code) = '' then
    raise exception 'No course code found in the file header' using errcode = '22023';
  end if;

  select * into v_cycle from public.academic_cycles where is_active;
  if v_cycle.id is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles, then try again.'
      using errcode = '22023';
  end if;

  select * into v_course
    from public.cluster_head_courses
   where lower(course_code) = lower(btrim(p_course_code))
     and cycle_id = v_cycle.id
     and (cluster_head_id = auth.uid() or public.is_hod() or auth.uid() is null)
   order by (cluster_head_id = auth.uid()) desc nulls last, created_at
   limit 1;

  -- A HOD keeps no subject list (0039): the subject is the file's own
  -- course, created the first time its code is uploaded this cycle.
  if v_course.id is null and auth.uid() is not null and public.is_hod() then
    insert into public.cluster_head_courses (cluster_head_id, cycle_id, course_code, course_name, display_order)
    values (auth.uid(), v_cycle.id, btrim(p_course_code),
            coalesce(nullif(btrim(coalesce(p_course_name, '')), ''), btrim(p_course_code)),
            coalesce((select max(display_order) + 1 from public.cluster_head_courses
                       where cluster_head_id = auth.uid() and cycle_id = v_cycle.id), 0)::smallint)
    on conflict (cluster_head_id, cycle_id, lower(course_code)) do nothing
    returning * into v_course;
    v_created := v_course.id is not null;
    if v_course.id is null then
      -- Another upload of the same file created it a moment ago.
      select * into v_course from public.cluster_head_courses
       where cluster_head_id = auth.uid() and cycle_id = v_cycle.id
         and lower(course_code) = lower(btrim(p_course_code));
    end if;
  end if;

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
    'course_created', v_created,
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

-- "Start one under Academic Cycles" is now on both portals' menus.
create or replace function public.tag_row_with_active_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.cycle_id is null then
    new.cycle_id := public.active_cycle_id();
  end if;
  if new.cycle_id is null and coalesce(tg_argv[0], '') = 'required' then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles, then try again.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function public.tag_attendance_with_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.cycle_id is null then
    select cycle_id into new.cycle_id from public.cluster_head_courses where id = new.course_id;
  end if;
  if new.cycle_id is null then
    new.cycle_id := public.active_cycle_id();
  end if;
  if new.cycle_id is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles, then try again.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function public.tag_black_dot_with_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.cycle_id is null then
    new.cycle_id := coalesce(
      case when new.incident_date is not null then public.cycle_containing(new.incident_date) end,
      public.active_cycle_id()
    );
  end if;
  if new.cycle_id is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles, then try again.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;


-- ---------------------------------------------------------------------
-- 11. The mentor-HOD mapping upload
-- ---------------------------------------------------------------------
-- One row per mentor or class coordinator:
--   { row, section, mentor_name, designation, mentor_email, hod_name, hod_email }
-- Accounts are matched on email. The API creates any account the file
-- introduces (HODs as 'hod', mentors as 'faculty') before calling this,
-- so a missing account here means that creation failed.
--
-- The HOD column decides the HOD role: a cluster head named there
-- becomes a HOD (their uploads and subjects stay theirs), and so does a
-- faculty member with no mentees. Anyone else (a student, a faculty
-- member who still has mentees, the administrator) is reported as a row
-- problem rather than changed.
--
-- Mentors are mapped as the file says; a mentor named twice ends on the
-- last row. Mentors the file does not mention keep their mapping, so a
-- file for some sections can be uploaded without the rest.
create or replace function public.map_faculty_to_hods(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item        jsonb;
  v_index       integer := 0;
  v_row_no      integer;
  v_hod_email   text;
  v_mentor_email text;
  v_section     text;
  v_designation text;
  v_hod         public.user_profiles;
  v_mentor      public.user_profiles;
  v_mentees     integer;
  v_total       integer := 0;
  v_mapped      integer := 0;
  v_unchanged   integer := 0;
  v_failed      integer := 0;
  v_promoted    integer := 0;
  v_hods        uuid[]  := array[]::uuid[];
  v_errors      jsonb   := '[]'::jsonb;
begin
  if not (public.is_admin() or auth.uid() is null) then
    raise exception 'Only the administrator can upload the mentor-HOD mapping' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Upload at most 5000 rows at a time' using errcode = '22023';
  end if;

  perform set_config('ssmp.trusted_operation', 'on', true);

  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_total := v_total + 1;
    v_row_no := coalesce(nullif(v_item ->> 'row', '')::integer, v_index);
    v_hod_email    := lower(btrim(coalesce(v_item ->> 'hod_email', '')));
    v_mentor_email := lower(btrim(coalesce(v_item ->> 'mentor_email', '')));
    v_section      := nullif(left(btrim(coalesce(v_item ->> 'section', '')), 40), '');
    v_designation  := nullif(left(btrim(coalesce(v_item ->> 'designation', '')), 80), '');

    if v_mentor_email = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'reason', 'No mentor email in this row');
      continue;
    end if;
    if v_hod_email = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_mentor_email,
                                                 'reason', 'No HOD email in this row');
      continue;
    end if;
    if v_hod_email = v_mentor_email then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_mentor_email,
                                                 'reason', 'The mentor and the HOD are the same person');
      continue;
    end if;

    -- The HOD ------------------------------------------------------------
    select * into v_hod from public.user_profiles where lower(email) = v_hod_email;
    if v_hod.id is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_hod_email,
                                                 'reason', 'No account has this HOD email');
      continue;
    end if;
    if v_hod.role <> 'hod' then
      select count(*) into v_mentees
        from public.user_profiles where assigned_mentor_id = v_hod.id and role = 'student';
      if v_hod.role = 'cluster_head' or (v_hod.role = 'faculty' and v_mentees = 0) then
        update public.user_profiles
           set role = 'hod', hod_id = null, hod_email = null,
               mentor_section = null, mentor_designation = null
         where id = v_hod.id
         returning * into v_hod;
        v_promoted := v_promoted + 1;
      else
        v_failed := v_failed + 1;
        v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_hod_email,
          'reason', case
            when v_hod.role = 'faculty'
              then format('This HOD is a faculty mentor with %s mentee(s). Move them to another mentor first.', v_mentees)
            else format('This HOD email belongs to an account with the %s role', replace(v_hod.role::text, '_', ' '))
          end);
        continue;
      end if;
    end if;
    if not v_hod.is_active then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_hod_email,
                                                 'reason', 'This HOD''s account is deactivated');
      continue;
    end if;

    -- The mentor ---------------------------------------------------------
    select * into v_mentor from public.user_profiles where lower(email) = v_mentor_email;
    if v_mentor.id is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_mentor_email,
                                                 'reason', 'No account has this mentor email');
      continue;
    end if;
    if v_mentor.role <> 'faculty' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row_no, 'identifier', v_mentor_email,
        'reason', format('This mentor email belongs to an account with the %s role, not a faculty member',
                         replace(v_mentor.role::text, '_', ' ')));
      continue;
    end if;

    if v_mentor.hod_id is not distinct from v_hod.id
       and v_mentor.hod_email is not distinct from v_hod.email
       and v_mentor.mentor_section is not distinct from v_section
       and v_mentor.mentor_designation is not distinct from v_designation then
      v_unchanged := v_unchanged + 1;
    else
      update public.user_profiles
         set hod_id             = v_hod.id,
             hod_email          = v_hod.email,
             mentor_section     = v_section,
             mentor_designation = v_designation
       where id = v_mentor.id;
      v_mapped := v_mapped + 1;
    end if;

    if not v_hod.id = any(v_hods) then
      v_hods := v_hods || v_hod.id;
    end if;
  end loop;

  perform set_config('ssmp.trusted_operation', 'off', true);

  return jsonb_build_object(
    'total_rows', v_total,
    'mapped',     v_mapped,
    'unchanged',  v_unchanged,
    'failed',     v_failed,
    'hods',       coalesce(array_length(v_hods, 1), 0),
    'promoted_to_hod', v_promoted,
    'row_errors', v_errors
  );
end;
$$;

comment on function public.map_faculty_to_hods(jsonb) is
  'Administrator only: applies the mentor-HOD mapping file (one row per mentor or class coordinator). See migration 0039.';


-- ---------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------
-- New functions only; create or replace keeps an existing function's
-- grants.
revoke all on function public.is_admin()                from public, anon;
revoke all on function public.my_overseen_faculty()     from public, anon;
revoke all on function public.oversees_faculty(uuid)    from public, anon;
revoke all on function public.oversees_student(uuid)    from public, anon;
revoke all on function public.map_faculty_to_hods(jsonb) from public, anon;
grant execute on function public.is_admin()                to authenticated, service_role;
grant execute on function public.my_overseen_faculty()     to authenticated, service_role;
grant execute on function public.oversees_faculty(uuid)    to authenticated, service_role;
grant execute on function public.oversees_student(uuid)    to authenticated, service_role;
grant execute on function public.map_faculty_to_hods(jsonb) to authenticated, service_role;
