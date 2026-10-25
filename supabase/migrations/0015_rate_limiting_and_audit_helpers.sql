-- =====================================================================
-- 0015  Durable rate limiting + audit helper
-- =====================================================================
-- Serverless functions are stateless and horizontally scaled, so an
-- in-memory counter rate-limits nothing. Counting in Postgres gives one
-- shared view across every warm instance.
-- =====================================================================

create table if not exists public.api_rate_limits (
  bucket_key    text        not null,
  window_start  timestamptz not null,
  request_count integer     not null default 0,
  primary key (bucket_key, window_start)
);

comment on table public.api_rate_limits is
  'Fixed-window counters for the privileged serverless endpoints. Written by the service role only.';

create index if not exists api_rate_limits_window_idx on public.api_rate_limits (window_start);

alter table public.api_rate_limits enable row level security;
-- No policies at all: unreachable from any client key. Service role only.

-- Returns true when the request is allowed, false when the caller is over
-- their quota for the current window.
create or replace function public.consume_rate_limit(
  p_bucket_key      text,
  p_max_requests    integer,
  p_window_seconds  integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits (bucket_key, window_start, request_count)
  values (p_bucket_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
    do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into v_count;

  -- opportunistic cleanup of old windows
  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------
-- Audit writer. Service role only — clients cannot forge audit entries.
-- ---------------------------------------------------------------------
create or replace function public.write_audit_entry(
  p_actor_id    uuid,
  p_action      text,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_metadata    jsonb default '{}'::jsonb,
  p_ip_address  text default null,
  p_user_agent  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.user_profiles where id = p_actor_id;
  insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address, user_agent)
  values (p_actor_id, v_role, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb),
          left(coalesce(p_ip_address, ''), 100), left(coalesce(p_user_agent, ''), 400));
end;
$$;

revoke all on function public.write_audit_entry(uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.write_audit_entry(uuid, text, text, text, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Feature 8 — bulk mentee reassignment, atomic
-- ---------------------------------------------------------------------
create or replace function public.reassign_mentees(
  p_student_ids  uuid[],
  p_to_mentor_id uuid,
  p_reason       text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.reassign_mentees(uuid[], uuid, text) from public, anon;
grant execute on function public.reassign_mentees(uuid[], uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Feature 8 — set a faculty member's employment / availability status
-- ---------------------------------------------------------------------
create or replace function public.set_faculty_employment_status(
  p_faculty_id   uuid,
  p_status       public.employment_status,
  p_available    boolean default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_profiles;
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can change faculty employment status' using errcode = '42501';
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
$$;

revoke all on function public.set_faculty_employment_status(uuid, public.employment_status, boolean) from public, anon;
grant execute on function public.set_faculty_employment_status(uuid, public.employment_status, boolean) to authenticated, service_role;
