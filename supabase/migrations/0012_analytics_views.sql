-- =====================================================================
-- 0012  Analytics views
-- =====================================================================
-- Every view is created WITH (security_invoker = true). Without that flag
-- a Postgres view runs with the privileges of its OWNER and silently
-- bypasses RLS — a classic Supabase data-leak footgun. With it, a faculty
-- member querying these views sees only their own rows.
-- =====================================================================

-- ── Per-faculty performance (drives Feature 4 + HOD leaderboard) ──────
drop view if exists public.faculty_performance_summary cascade;
create view public.faculty_performance_summary
with (security_invoker = true) as
select
  f.id                                              as faculty_id,
  f.full_name                                       as faculty_name,
  f.email                                           as faculty_email,
  f.login_id                                        as faculty_login_id,
  f.branch,
  f.department,
  f.employment_status,
  f.available_for_reassignment,
  f.mentee_capacity,
  (select count(*) from public.user_profiles s
     where s.assigned_mentor_id = f.id and s.role = 'student')          as mentee_count,
  count(t.id)                                                           as total_tickets,
  count(t.id) filter (where t.status = 'Open')                          as open_tickets,
  count(t.id) filter (where t.status = 'In Progress')                   as in_progress_tickets,
  count(t.id) filter (where t.status = 'Resolved')                      as resolved_tickets,
  count(t.id) filter (where t.category = 'Academic')                    as academic_tickets,
  count(t.id) filter (where t.category = 'ERP/Tech')                    as erp_tech_tickets,
  count(t.id) filter (where t.category = 'Infrastructure')              as infrastructure_tickets,
  count(t.id) filter (where t.resolution_status = 'confirmed')          as confirmed_resolutions,
  count(t.id) filter (where t.resolution_status = 'reopened')           as reopened_resolutions,
  count(t.id) filter (where t.resolution_status = 'pending_confirmation') as awaiting_confirmation,
  round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 3600.0)
        filter (where t.first_response_at is not null)::numeric, 1)     as avg_first_response_hours,
  round(avg(extract(epoch from (t.resolved_at - t.created_at)) / 3600.0)
        filter (where t.resolved_at is not null)::numeric, 1)           as avg_resolution_hours,
  round(avg(t.satisfaction_rating)
        filter (where t.satisfaction_rating is not null)::numeric, 2)   as avg_satisfaction,
  count(t.id) filter (where t.satisfaction_rating is not null)          as rated_tickets,
  case when count(t.id) = 0 then 0
       else round(100.0 * count(t.id) filter (where t.status = 'Resolved') / count(t.id), 1)
  end                                                                   as resolution_rate_percent
from public.user_profiles f
left join public.support_tickets t on t.mentor_id = f.id
where f.role = 'faculty'
group by f.id;

comment on view public.faculty_performance_summary is
  'Per-faculty ticket metrics. Powers Feature 4 (faculty self-report) and the HOD leaderboard.';

-- ── Per-student summary (drives Feature 5) ───────────────────────────
drop view if exists public.student_ticket_summary cascade;
create view public.student_ticket_summary
with (security_invoker = true) as
select
  s.id                                                        as student_id,
  s.full_name                                                 as student_name,
  s.login_id                                                  as registration_no,
  s.email,
  s.section,
  s.branch,
  s.semester_label,
  s.assigned_mentor_id,
  s.is_star_mentee,
  s.form_a_completed,
  count(t.id)                                                 as total_tickets,
  count(t.id) filter (where t.status = 'Open')                as open_tickets,
  count(t.id) filter (where t.status = 'In Progress')         as in_progress_tickets,
  count(t.id) filter (where t.status = 'Resolved')            as resolved_tickets,
  count(t.id) filter (where t.category = 'Academic')          as academic_tickets,
  count(t.id) filter (where t.category = 'ERP/Tech')          as erp_tech_tickets,
  count(t.id) filter (where t.category = 'Infrastructure')    as infrastructure_tickets,
  count(t.id) filter (where t.resolution_status = 'confirmed') as confirmed_resolutions,
  count(t.id) filter (where t.resolution_status = 'reopened')  as reopened_resolutions,
  round(avg(t.satisfaction_rating)
        filter (where t.satisfaction_rating is not null)::numeric, 2) as avg_rating_given,
  max(t.created_at)                                           as last_ticket_at
from public.user_profiles s
left join public.support_tickets t on t.student_id = s.id
where s.role = 'student'
group by s.id;

-- ── Daily ticket trend (sparklines on the HOD + faculty dashboards) ───
drop view if exists public.ticket_daily_trend cascade;
create view public.ticket_daily_trend
with (security_invoker = true) as
select
  t.mentor_id,
  date_trunc('day', t.created_at)::date                          as day,
  count(*)                                                       as tickets_created,
  count(*) filter (where t.status = 'Resolved')                  as tickets_resolved,
  count(*) filter (where t.category = 'Academic')                as academic,
  count(*) filter (where t.category = 'ERP/Tech')                as erp_tech,
  count(*) filter (where t.category = 'Infrastructure')          as infrastructure
from public.support_tickets t
group by t.mentor_id, date_trunc('day', t.created_at)::date;

-- ── Faculty reserve pool with live capacity (Feature 8) ───────────────
drop view if exists public.faculty_reserve_pool cascade;
create view public.faculty_reserve_pool
with (security_invoker = true) as
select
  f.id                as faculty_id,
  f.full_name,
  f.email,
  f.login_id,
  f.branch,
  f.employment_status,
  f.available_for_reassignment,
  f.mentee_capacity,
  coalesce(m.mentee_count, 0)                          as current_mentees,
  greatest(f.mentee_capacity - coalesce(m.mentee_count, 0), 0) as remaining_capacity
from public.user_profiles f
left join (
  select assigned_mentor_id, count(*) as mentee_count
    from public.user_profiles
   where role = 'student' and assigned_mentor_id is not null
   group by assigned_mentor_id
) m on m.assigned_mentor_id = f.id
where f.role = 'faculty';

grant select on public.faculty_performance_summary to authenticated;
grant select on public.student_ticket_summary      to authenticated;
grant select on public.ticket_daily_trend          to authenticated;
grant select on public.faculty_reserve_pool        to authenticated;
