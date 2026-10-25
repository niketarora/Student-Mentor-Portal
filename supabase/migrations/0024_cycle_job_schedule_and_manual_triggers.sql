-- =====================================================================
-- 0024  The 15-day job schedule, and the on-demand trigger for all of it
-- =====================================================================
-- THE PROBLEM THIS SOLVES
-- ---------------------------------------------------------------------
-- Three things are supposed to happen every 15 days: a new survey opens,
-- risk flags get re-swept, and meetings/notifications go out for whoever
-- is flagged. Two awkward facts follow from that:
--
--   1. Nobody wants to wait 15 days to find out whether any of it works.
--   2. It would be very easy — and wrong — to hang these off the Cluster
--      Head's attendance upload, because that also happens "every 15
--      days". Then an early or late upload would drag the survey window
--      with it, and a Cluster Head who uploaded twice would open two
--      survey cycles.
--
-- So the schedule lives here, in its own table, with its own clock. An
-- attendance upload never touches next_run_due_on. Uploads re-evaluate the
-- risk of the students in that file (migration 0022) and stop there.
--
-- HOW TO FIRE ANYTHING ON DEMAND
-- ---------------------------------------------------------------------
--   select public.run_cycle_job('survey_cycle');
--   select public.run_cycle_job('at_risk_sweep');
--   select public.run_cycle_job('at_risk_meeting_dispatch');
--   select public.run_cycle_job('survey_reminder_sweep');
--   select public.run_all_cycle_jobs_now();     -- all four, in order
--
-- A manual run does the real work but deliberately does NOT advance
-- next_run_due_on. Testing the survey ten times this afternoon leaves the
-- 15-day rhythm exactly where it was.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The schedule — one row per recurring job
-- ---------------------------------------------------------------------
create table if not exists public.cycle_job_schedule (
  job_type          public.cycle_job_type primary key,
  interval_days     integer     not null default 15,
  is_enabled        boolean     not null default true,
  next_run_due_on   date        not null default current_date,
  last_run_at       timestamptz,
  last_run_status   public.cycle_job_status,
  last_manual_run_at timestamptz,
  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint cycle_job_interval_sane check (interval_days between 1 and 365)
);

drop trigger if exists trg_cycle_job_schedule_updated_at on public.cycle_job_schedule;
create trigger trg_cycle_job_schedule_updated_at
  before update on public.cycle_job_schedule
  for each row execute function public.set_updated_at_timestamp();

insert into public.cycle_job_schedule (job_type, interval_days, description) values
  ('survey_cycle', 15,
   'Opens the next department-wide student feedback survey and notifies every student.'),
  ('survey_reminder_sweep', 7,
   'Nudges students who have not yet answered the survey that is currently open.'),
  ('at_risk_sweep', 15,
   'Re-evaluates every student against the attendance / GPA / backlog rule.'),
  ('at_risk_meeting_dispatch', 15,
   'Raises a mentor-owned meeting for every flagged student who does not already have one, and notifies the mentor.')
on conflict (job_type) do update set description = excluded.description;

comment on table public.cycle_job_schedule is
  'The 15-day clock. Independent of Cluster Head uploads by design: nothing in the upload path reads or writes next_run_due_on.';


-- ---------------------------------------------------------------------
-- 2. Run log
-- ---------------------------------------------------------------------
create table if not exists public.cycle_job_runs (
  id             uuid primary key default extensions.gen_random_uuid(),
  job_type       public.cycle_job_type not null,
  trigger_source public.cycle_job_trigger not null,
  status         public.cycle_job_status not null default 'running',
  triggered_by   uuid references public.user_profiles (id) on delete set null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  duration_ms    integer,
  result         jsonb not null default '{}'::jsonb,
  error_message  text,
  note           text
);

create index if not exists cycle_job_runs_recent_idx
  on public.cycle_job_runs (job_type, started_at desc);

comment on table public.cycle_job_runs is
  'Every execution of a recurring job, scheduled or manual, with what it did. This is the audit trail for "did the trigger actually work".';


-- ---------------------------------------------------------------------
-- 3. RLS — HOD only. These rows describe department-wide operations.
-- ---------------------------------------------------------------------
alter table public.cycle_job_schedule enable row level security;
alter table public.cycle_job_runs     enable row level security;

drop policy if exists cycle_schedule_select_hod on public.cycle_job_schedule;
drop policy if exists cycle_runs_select_hod     on public.cycle_job_runs;

create policy cycle_schedule_select_hod on public.cycle_job_schedule
  for select to authenticated using (public.is_hod());

create policy cycle_runs_select_hod on public.cycle_job_runs
  for select to authenticated using (public.is_hod());

-- No INSERT/UPDATE policies: rows are written only by run_cycle_job(),
-- so the run log cannot be forged or edited after the fact.
grant select on public.cycle_job_schedule to authenticated;
grant select on public.cycle_job_runs     to authenticated;


-- =====================================================================
-- 4. The trigger
-- =====================================================================
-- Runs one job now, records what happened, and returns a summary.
--
-- p_trigger = 'manual'    -> real work, schedule untouched   (testing)
-- p_trigger = 'scheduled' -> real work, next_run_due_on moves forward
create or replace function public.run_cycle_job(
  p_job_type public.cycle_job_type,
  p_trigger  public.cycle_job_trigger default 'manual',
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id   uuid;
  v_started  timestamptz := clock_timestamp();
  v_result   jsonb;
  v_cycle    public.survey_cycles;
  v_schedule public.cycle_job_schedule;
begin
  -- auth.uid() is null covers a migration, a SQL console, or a server-side
  -- call made with the service role — the same escape hatch every other
  -- privileged function in this codebase uses.
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can run a cycle job' using errcode = '42501';
  end if;

  select * into v_schedule from public.cycle_job_schedule where job_type = p_job_type;
  if v_schedule.job_type is null then
    raise exception 'Unknown job type %', p_job_type using errcode = 'P0002';
  end if;

  insert into public.cycle_job_runs (job_type, trigger_source, triggered_by, note)
  values (p_job_type, p_trigger, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_run_id;

  begin
    case p_job_type
      when 'survey_cycle' then
        v_cycle := public.open_survey_cycle(p_trigger, v_run_id, v_schedule.interval_days);
        v_result := jsonb_build_object(
          'cycle_number', v_cycle.cycle_number,
          'opens_on',     v_cycle.opens_on,
          'closes_on',    v_cycle.closes_on,
          'students_notified', (select count(*) from public.user_profiles where role = 'student' and is_active)
        );

      when 'survey_reminder_sweep' then
        v_result := public.send_survey_reminders();

      when 'at_risk_sweep' then
        v_result := public.evaluate_all_students_risk();

      when 'at_risk_meeting_dispatch' then
        v_result := public.dispatch_at_risk_meetings(v_run_id);
    end case;

    update public.cycle_job_runs
       set status      = 'succeeded',
           finished_at = now(),
           duration_ms = (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer,
           result      = coalesce(v_result, '{}'::jsonb)
     where id = v_run_id;

  exception when others then
    -- A failed job must still leave a legible trace; re-raising after
    -- recording keeps the caller's error message intact.
    update public.cycle_job_runs
       set status        = 'failed',
           finished_at   = now(),
           duration_ms   = (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer,
           error_message = sqlerrm
     where id = v_run_id;

    update public.cycle_job_schedule
       set last_run_at = now(), last_run_status = 'failed'
     where job_type = p_job_type;

    raise;
  end;

  -- ── The independence rule, in one statement ──────────────────────
  -- Only a SCHEDULED run moves the clock. A manual run is a test: it does
  -- the work, records it, and leaves the 15-day cadence alone. And note
  -- what is absent — nothing here consults, or is consulted by, the
  -- attendance upload path.
  if p_trigger = 'scheduled' then
    update public.cycle_job_schedule
       set last_run_at     = now(),
           last_run_status = 'succeeded',
           next_run_due_on = greatest(current_date, next_run_due_on) + v_schedule.interval_days
     where job_type = p_job_type;
  else
    update public.cycle_job_schedule
       set last_run_at        = now(),
           last_run_status    = 'succeeded',
           last_manual_run_at = now()
     where job_type = p_job_type;
  end if;

  return jsonb_build_object(
    'job_type',       p_job_type,
    'trigger_source', p_trigger,
    'run_id',         v_run_id,
    'status',         'succeeded',
    'result',         coalesce(v_result, '{}'::jsonb),
    'schedule_advanced', p_trigger = 'scheduled'
  );
end;
$$;


-- Everything at once, in dependency order: sweep the flags first so the
-- meeting dispatch sees fresh data. This is the "one button" for testing.
create or replace function public.run_all_cycle_jobs_now(p_note text default 'manual test run')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can run the cycle jobs' using errcode = '42501';
  end if;

  v_out := v_out || public.run_cycle_job('at_risk_sweep',            'manual', p_note);
  v_out := v_out || public.run_cycle_job('at_risk_meeting_dispatch', 'manual', p_note);
  v_out := v_out || public.run_cycle_job('survey_cycle',             'manual', p_note);

  return jsonb_build_object('runs', v_out);
end;
$$;


-- What a real cron (Vercel Cron, pg_cron, an external scheduler) calls.
-- Nothing calls this today; it exists so the scheduled path is written and
-- reviewable rather than improvised later.
create or replace function public.run_due_cycle_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.cycle_job_schedule;
  v_out jsonb := '[]'::jsonb;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD or a trusted server call can run due jobs' using errcode = '42501';
  end if;

  for v_job in
    select * from public.cycle_job_schedule
     where is_enabled and next_run_due_on <= current_date
     order by case job_type
                when 'at_risk_sweep' then 1
                when 'at_risk_meeting_dispatch' then 2
                else 3
              end
  loop
    v_out := v_out || public.run_cycle_job(v_job.job_type, 'scheduled', 'due on schedule');
  end loop;

  return jsonb_build_object('runs', v_out);
end;
$$;


-- Powers the HOD's operations panel: what each job is, when it last ran,
-- when it is next due, and what the last run actually did.
create or replace function public.get_cycle_job_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_hod() then
    raise exception 'Only the HOD can view job status' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job_type',           s.job_type,
        'description',        s.description,
        'interval_days',      s.interval_days,
        'is_enabled',         s.is_enabled,
        'next_run_due_on',    s.next_run_due_on,
        'last_run_at',        s.last_run_at,
        'last_run_status',    s.last_run_status,
        'last_manual_run_at', s.last_manual_run_at
      ) order by s.job_type)
      from public.cycle_job_schedule s
    ), '[]'::jsonb),
    'recent_runs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',             r.id,
        'job_type',       r.job_type,
        'trigger_source', r.trigger_source,
        'status',         r.status,
        'started_at',     r.started_at,
        'duration_ms',    r.duration_ms,
        'result',         r.result,
        'error_message',  r.error_message,
        'note',           r.note
      ) order by r.started_at desc)
      from (select * from public.cycle_job_runs order by started_at desc limit 25) r
    ), '[]'::jsonb),
    'active_survey_cycle', (
      select jsonb_build_object('cycle_number', c.cycle_number, 'opens_on', c.opens_on, 'closes_on', c.closes_on)
        from public.survey_cycles c where c.is_active limit 1
    ),
    'at_risk_count',        (select count(*) from public.student_risk_flags where is_at_risk),
    'open_meeting_count',   (select count(*) from public.at_risk_meetings where status in ('awaiting_link', 'scheduled'))
  );
end;
$$;


revoke all on function public.run_cycle_job(public.cycle_job_type, public.cycle_job_trigger, text) from public, anon;
revoke all on function public.run_all_cycle_jobs_now(text)  from public, anon;
revoke all on function public.run_due_cycle_jobs()          from public, anon;
revoke all on function public.get_cycle_job_status()        from public, anon;

grant execute on function public.run_cycle_job(public.cycle_job_type, public.cycle_job_trigger, text) to authenticated, service_role;
grant execute on function public.run_all_cycle_jobs_now(text) to authenticated, service_role;
grant execute on function public.run_due_cycle_jobs()         to authenticated, service_role;
grant execute on function public.get_cycle_job_status()       to authenticated;
