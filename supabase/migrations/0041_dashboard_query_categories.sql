-- =====================================================================
-- 0041  Dashboard charts count queries by their current categories
-- =====================================================================
-- Migration 0026 replaced the query categories (Academic, ERP/Tech,
-- Infrastructure) with Academics, Examination, Behavioural,
-- Administrative and Others. The Home pages' category charts were never
-- moved over:
--
--   * the student's "Recent activity by category" and the faculty
--     member's "Recent load by category" counted the old three among the
--     few queries loaded for the recent list, so they stayed at zero;
--
--   * the HOD's and administrator's "Category load" read academic_queries,
--     erp_tech_queries and infrastructure_queries from this function,
--     which count only the old three.
--
-- get_dashboard_metrics() now also returns queries_by_category, an object
-- of category -> count over every query the caller's dashboard covers
-- (the student's own, the mentor's, the HOD's faculty's, or the
-- department's), current and legacy categories alike. Everything else it
-- returns is unchanged, including the three legacy keys, so the frontend
-- before this change keeps working.
-- =====================================================================

create or replace function public.get_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
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
      -- Every query by its category, current and legacy (0041).
      'queries_by_category',
        (select coalesce(jsonb_object_agg(c.category, c.n), '{}'::jsonb)
           from (select category::text as category, count(*) as n
                   from public.support_queries
                  where student_id = v_me.id
                  group by category) c),
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
      -- Every query by its category, current and legacy (0041).
      'queries_by_category',
        (select coalesce(jsonb_object_agg(c.category, c.n), '{}'::jsonb)
           from (select category::text as category, count(*) as n
                   from public.support_queries
                  where mentor_id = v_me.id
                  group by category) c),
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
      -- Legacy categories only (0026 replaced them); kept so an older
      -- frontend keeps working. Charts read queries_by_category.
      'academic_queries',     count(*) filter (where category = 'Academic'),
      'erp_tech_queries',     count(*) filter (where category = 'ERP/Tech'),
      'infrastructure_queries', count(*) filter (where category = 'Infrastructure')
    ) into v_result
    from public.support_queries
    where not v_scoped or mentor_id = any(v_faculty);

    v_result := v_result || jsonb_build_object(
      -- Every query by its category, current and legacy (0041).
      'queries_by_category',
        (select coalesce(jsonb_object_agg(c.category, c.n), '{}'::jsonb)
           from (select category::text as category, count(*) as n
                   from public.support_queries
                  where not v_scoped or mentor_id = any(v_faculty)
                  group by category) c),
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
$function$;

revoke all on function public.get_dashboard_metrics() from public, anon;
grant execute on function public.get_dashboard_metrics() to authenticated;
