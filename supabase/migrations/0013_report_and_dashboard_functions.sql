-- =====================================================================
-- 0013  Report + dashboard RPCs
-- =====================================================================
-- One source of truth for report numbers: the UI charts and the server
-- side PDF generator both call these, so a printed report can never
-- disagree with what was on screen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role-aware dashboard metrics
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     public.user_profiles;
  v_result jsonb;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_me.role = 'student' then
    select jsonb_build_object(
      'role', 'student',
      'total_tickets',        count(*),
      'open_tickets',         count(*) filter (where status = 'Open'),
      'in_progress_tickets',  count(*) filter (where status = 'In Progress'),
      'resolved_tickets',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'unrated_resolved',     count(*) filter (where status = 'Resolved' and satisfaction_rating is null),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1)
    ) into v_result
    from public.support_tickets where student_id = v_me.id;

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
      'total_tickets',        count(*),
      'open_tickets',         count(*) filter (where status = 'Open'),
      'in_progress_tickets',  count(*) filter (where status = 'In Progress'),
      'resolved_tickets',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'reopened_tickets',     count(*) filter (where resolution_status = 'reopened'),
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
    from public.support_tickets where mentor_id = v_me.id;

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

  else  -- hod
    select jsonb_build_object(
      'role', 'hod',
      'total_tickets',        count(*),
      'open_tickets',         count(*) filter (where status = 'Open'),
      'in_progress_tickets',  count(*) filter (where status = 'In Progress'),
      'resolved_tickets',     count(*) filter (where status = 'Resolved'),
      'awaiting_confirmation',count(*) filter (where resolution_status = 'pending_confirmation'),
      'reopened_tickets',     count(*) filter (where resolution_status = 'reopened'),
      'avg_first_response_hours', round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                        filter (where first_response_at is not null)::numeric, 1),
      'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                    filter (where resolved_at is not null)::numeric, 1),
      'avg_satisfaction',     round(avg(satisfaction_rating)
                                    filter (where satisfaction_rating is not null)::numeric, 2),
      'academic_tickets',     count(*) filter (where category = 'Academic'),
      'erp_tech_tickets',     count(*) filter (where category = 'ERP/Tech'),
      'infrastructure_tickets', count(*) filter (where category = 'Infrastructure')
    ) into v_result
    from public.support_tickets;

    v_result := v_result || jsonb_build_object(
      'total_students', (select count(*) from public.user_profiles where role = 'student'),
      'total_faculty',  (select count(*) from public.user_profiles where role = 'faculty'),
      'active_faculty', (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'active'),
      'departed_faculty', (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'departed'),
      'unassigned_students', (select count(*) from public.user_profiles where role = 'student' and assigned_mentor_id is null),
      'onboarding_pending', (select count(*) from public.user_profiles where role = 'student' and form_a_completed = false),
      'unread_notifications',
        (select count(*) from public.notifications where recipient_id = v_me.id and is_read = false)
    );
  end if;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- FEATURE 4 — per-faculty activity report (analytical, chart-ready)
-- Faculty may only pull their own. HOD may pull anyone's.
-- ---------------------------------------------------------------------
create or replace function public.get_faculty_activity_report(
  p_faculty_id uuid default null,
  p_from       date default null,
  p_to         date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_faculty_id uuid := coalesce(p_faculty_id, auth.uid());
  v_from       timestamptz := coalesce(p_from, (current_date - interval '90 days')::date)::timestamptz;
  v_to         timestamptz := (coalesce(p_to, current_date) + interval '1 day')::timestamptz;
  v_faculty    public.user_profiles;
  v_report     jsonb;
begin
  -- isAssignedMentor(self) OR isHod
  if v_faculty_id <> auth.uid() and not public.is_hod() then
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
        'total_tickets',        count(*),
        'open_tickets',         count(*) filter (where status = 'Open'),
        'in_progress_tickets',  count(*) filter (where status = 'In Progress'),
        'resolved_tickets',     count(*) filter (where status = 'Resolved'),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction',     coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'rated_tickets',        count(*) filter (where satisfaction_rating is not null),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_tickets
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
        from public.support_tickets
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by category) c),

    -- stacked bar chart: status mix -----------------------------------
    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'total', total) order by status), '[]'::jsonb)
      from (select status, count(*) as total
              from public.support_tickets
             where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
             group by status) s),

    -- donut chart: Feature 3 confirmation outcomes --------------------
    'resolution_confirmation', (
      select jsonb_build_object(
        'confirmed_yes',        count(*) filter (where resolution_status = 'confirmed'),
        'reopened_no',          count(*) filter (where resolution_status = 'reopened'),
        'awaiting_response',    count(*) filter (where resolution_status = 'pending_confirmation'),
        'never_resolved',       count(*) filter (where resolution_status = 'none'))
      from public.support_tickets
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
        from public.support_tickets
        where mentor_id = v_faculty_id and created_at >= v_from and created_at < v_to
        group by 1) w),

    -- bar chart: satisfaction histogram -------------------------------
    'rating_distribution', (
      select coalesce(jsonb_object_agg(rating::text, cnt), '{}'::jsonb)
      from (select satisfaction_rating as rating, count(*) as cnt
              from public.support_tickets
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
               'ticket_count', (select count(*) from public.support_tickets t
                                 where t.student_id = s.id and t.mentor_id = v_faculty_id))
               order by s.full_name), '[]'::jsonb)
      from public.user_profiles s
      where s.assigned_mentor_id = v_faculty_id and s.role = 'student')
  ) into v_report;

  return v_report;
end;
$$;

-- ---------------------------------------------------------------------
-- FEATURE 5 — per-student dossier generated by the mentor
-- (No parent-communication section: parents are out of scope.)
-- ---------------------------------------------------------------------
create or replace function public.get_student_dossier(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student   public.user_profiles;
  v_can_see_gpa boolean;
  v_report    jsonb;
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
                 'semester', semester_number, 'gpa', gpa, 'updated_at', updated_at)
                 order by semester_number), '[]'::jsonb)
        from public.student_semester_gpas where student_id = p_student_id)
      else '[]'::jsonb end,
    'gpa_stats', case when v_can_see_gpa then (
        select jsonb_build_object(
          'semesters_recorded', count(*),
          'cgpa', coalesce(round(avg(gpa)::numeric, 2), 0),
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

    -- Ticket history + Feature 3 outcomes -----------------------------
    'ticket_summary', (
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
      from public.support_tickets where student_id = p_student_id),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ticket_code', ticket_code, 'subject', subject, 'category', category,
               'status', status, 'resolution_status', resolution_status,
               'created_at', created_at, 'resolved_at', resolved_at,
               'satisfaction_rating', satisfaction_rating,
               'confirmation', student_confirmation,
               'confirmation_comment', student_confirmation_comment)
               order by created_at desc), '[]'::jsonb)
      from public.support_tickets where student_id = p_student_id),
    'monthly_ticket_trend', (
      select coalesce(jsonb_agg(jsonb_build_object('month', month, 'count', cnt) order by month), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*) as cnt
              from public.support_tickets where student_id = p_student_id
             group by 1) m)
  ) into v_report;

  return v_report;
end;
$$;

revoke all on function public.get_dashboard_metrics()                       from public, anon;
revoke all on function public.get_faculty_activity_report(uuid, date, date) from public, anon;
revoke all on function public.get_student_dossier(uuid)                     from public, anon;

grant execute on function public.get_dashboard_metrics()                       to authenticated;
grant execute on function public.get_faculty_activity_report(uuid, date, date) to authenticated;
grant execute on function public.get_student_dossier(uuid)                     to authenticated;
