-- =====================================================================
-- 0019  Profile photos  ·  combined roster import  ·  department report
-- =====================================================================

-- ── 1. Combined roster imports ───────────────────────────────────────
-- One spreadsheet containing both faculty and students, distinguished by
-- a Role column. Faculty rows are always processed first so a student's
-- "Mentor Email" can resolve against someone created in the same file.
alter type public.roster_import_type add value if not exists 'combined';


-- ── 2. Profile photos ────────────────────────────────────────────────
-- user_profiles.avatar_url already exists (migration 0002) and is NOT in
-- the protected-column list, so a user can set their own without needing
-- an RPC. It stores a Storage object path, never a public URL.
comment on column public.user_profiles.avatar_url is
  'Storage object path in the profile-photos bucket, e.g. <uuid>/avatar-1712345678.png. Never a public URL.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 3145728,
        array['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_photos_insert_own   on storage.objects;
drop policy if exists profile_photos_update_own   on storage.objects;
drop policy if exists profile_photos_delete_own   on storage.objects;
drop policy if exists profile_photos_select_any   on storage.objects;

-- Write only into your own folder, same convention as the other buckets.
create policy profile_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy profile_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy profile_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- READ is open to any signed-in user, unlike the other buckets.
-- Reasoning: an avatar appears next to its owner's name in ticket threads,
-- mentee tables and leaderboards, so scoping reads the way Form A uploads
-- are scoped would leave most of them broken. A face photo is far less
-- sensitive than a home address, the bucket is still private to the
-- outside world, and links are short-lived signed URLs.
create policy profile_photos_select_any on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos');


-- ── 3. Consolidated department report (HOD: "All faculty members") ───
create or replace function public.get_department_faculty_report(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from   timestamptz := coalesce(p_from, (current_date - interval '90 days')::date)::timestamptz;
  v_to     timestamptz := (coalesce(p_to, current_date) + interval '1 day')::timestamptz;
  v_report jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can generate a department-wide report' using errcode = '42501';
  end if;
  if v_to <= v_from then
    raise exception 'The "to" date must be after the "from" date' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'scope', 'department',
    'department', coalesce((select department from public.user_profiles where id = auth.uid()), 'IoT & IS'),
    'period', jsonb_build_object('from', v_from::date, 'to', (v_to - interval '1 day')::date),
    'generated_at', now(),

    -- headline numbers across the whole department -------------------
    'summary', (
      select jsonb_build_object(
        'faculty_count',   (select count(*) from public.user_profiles where role = 'faculty'),
        'active_faculty',  (select count(*) from public.user_profiles where role = 'faculty' and employment_status = 'active'),
        'student_count',   (select count(*) from public.user_profiles where role = 'student'),
        'unassigned_students', (select count(*) from public.user_profiles where role = 'student' and assigned_mentor_id is null),
        'total_tickets',   count(*),
        'open_tickets',    count(*) filter (where status = 'Open'),
        'in_progress_tickets', count(*) filter (where status = 'In Progress'),
        'resolved_tickets',count(*) filter (where status = 'Resolved'),
        'escalated_tickets', count(*) filter (where escalated_to_hod),
        'avg_first_response_hours', coalesce(round(avg(extract(epoch from (first_response_at - created_at))/3600.0)
                                     filter (where first_response_at is not null)::numeric, 1), 0),
        'avg_resolution_hours', coalesce(round(avg(extract(epoch from (resolved_at - created_at))/3600.0)
                                     filter (where resolved_at is not null)::numeric, 1), 0),
        'avg_satisfaction', coalesce(round(avg(satisfaction_rating)
                                     filter (where satisfaction_rating is not null)::numeric, 2), 0),
        'resolution_rate_percent',
            case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where status = 'Resolved') / count(*), 1) end)
      from public.support_tickets
      where created_at >= v_from and created_at < v_to),

    -- department-wide category mix (chart) ----------------------------
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category, 'total', total, 'resolved', resolved) order by category), '[]'::jsonb)
      from (select category, count(*) as total, count(*) filter (where status = 'Resolved') as resolved
              from public.support_tickets
             where created_at >= v_from and created_at < v_to
             group by category) c),

    -- department-wide status mix (chart) ------------------------------
    'by_status', (
      select jsonb_build_object(
        'open',        count(*) filter (where status = 'Open'),
        'in_progress', count(*) filter (where status = 'In Progress'),
        'resolved',    count(*) filter (where status = 'Resolved'))
      from public.support_tickets
      where created_at >= v_from and created_at < v_to),

    -- monthly volume (chart) ------------------------------------------
    'monthly_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', month, 'created', created_count, 'resolved', resolved_count) order by month), '[]'::jsonb)
      from (select to_char(date_trunc('month', created_at), 'Mon YY') as month,
                   date_trunc('month', created_at)                    as sort_key,
                   count(*)                                           as created_count,
                   count(*) filter (where status = 'Resolved')        as resolved_count
              from public.support_tickets
             where created_at >= v_from and created_at < v_to
             group by 1, 2 order by 2) m),

    -- one row per faculty member (the tabular half) --------------------
    'faculty', (
      select coalesce(jsonb_agg(row order by (row ->> 'resolved_tickets')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', f.id,
          'name', f.full_name,
          'login_id', f.login_id,
          'branch', f.branch,
          'employment_status', f.employment_status,
          'mentee_count', (select count(*) from public.user_profiles s
                            where s.assigned_mentor_id = f.id and s.role = 'student'),
          'total_tickets',    count(t.id),
          'open_tickets',     count(t.id) filter (where t.status = 'Open'),
          'in_progress_tickets', count(t.id) filter (where t.status = 'In Progress'),
          'resolved_tickets', count(t.id) filter (where t.status = 'Resolved'),
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
        left join public.support_tickets t
               on t.mentor_id = f.id and t.created_at >= v_from and t.created_at < v_to
        where f.role = 'faculty'
        group by f.id
      ) rows)
  ) into v_report;

  return v_report;
end;
$$;

revoke all on function public.get_department_faculty_report(date, date) from public, anon;
grant execute on function public.get_department_faculty_report(date, date) to authenticated;
