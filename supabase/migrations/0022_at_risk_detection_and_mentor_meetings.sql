-- =====================================================================
-- 0022  At-risk detection, mentor-owned meetings, and the upload RPCs
-- =====================================================================
-- THE RULE
-- ---------------------------------------------------------------------
-- A student is at risk when ANY ONE of these holds:
--   * overall attendance below 75%
--   * latest GPA below 6
--   * at least one backlog on record (one is enough)
--
-- ANY, not ALL. The brief said "all three of these are true at once or
-- any of the one", which is self-contradictory; ANY was chosen because a
-- student failing badly on a single axis is precisely who a mentorship
-- system exists to catch, and because the narrower AND reading would let
-- a student with 30% attendance go unnoticed as long as their GPA held up.
-- Each condition only fires when the underlying data actually exists, so a
-- newly enrolled student with no records yet is not flagged by default.
--
-- WHEN IT RUNS
-- ---------------------------------------------------------------------
-- Every time attendance or backlog/GPA data arrives (the record_*_batch
-- functions below call it), and again on the 15-day sweep in migration
-- 0024. The two paths are independent: an upload never moves the schedule,
-- and the schedule never waits for an upload.
--
-- THE MEETING
-- ---------------------------------------------------------------------
-- Flagging raises a meeting whose OWNER is the student's mentor — not the
-- cluster head, not the HOD. Everything about that meeting is real except
-- the joinable URL: create_at_risk_meeting_link() is a deliberate stub
-- that returns nothing while Teams vs Google Meet is still being decided.
-- The mentor is notified either way, so the workflow is complete today and
-- swapping in a real provider later is a one-function change.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Risk flags — one row per student, rewritten on every evaluation
-- ---------------------------------------------------------------------
create table if not exists public.student_risk_flags (
  student_id          uuid primary key references public.user_profiles (id) on delete cascade,
  is_at_risk          boolean     not null default false,

  -- which of the three conditions tripped; kept separately so the mentor
  -- sees the reason rather than just a red dot
  low_attendance      boolean     not null default false,
  low_gpa             boolean     not null default false,
  has_backlog         boolean     not null default false,

  -- the numbers the decision was made from, snapshotted for display
  attendance_percent  numeric(5,2),
  latest_gpa          numeric(4,2),
  latest_gpa_semester smallint,
  backlog_count       integer     not null default 0,
  reasons             text[]      not null default array[]::text[],

  first_flagged_at    timestamptz,
  last_flagged_at     timestamptz,
  cleared_at          timestamptz,
  last_evaluated_at   timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists student_risk_flags_at_risk_idx
  on public.student_risk_flags (is_at_risk) where is_at_risk = true;

drop trigger if exists trg_student_risk_flags_updated_at on public.student_risk_flags;
create trigger trg_student_risk_flags_updated_at
  before update on public.student_risk_flags
  for each row execute function public.set_updated_at_timestamp();

comment on table public.student_risk_flags is
  'At-risk state per student. ANY of low attendance / low GPA / a backlog sets is_at_risk. Rewritten by evaluate_student_risk() whenever new academic data lands.';


-- ---------------------------------------------------------------------
-- 2. Meetings — mentor is the owner/organiser
-- ---------------------------------------------------------------------
create table if not exists public.at_risk_meetings (
  id                 uuid primary key default extensions.gen_random_uuid(),
  student_id         uuid not null references public.user_profiles (id) on delete cascade,
  -- The organiser. Named explicitly rather than derived at read time so the
  -- record still says who owned it after a Feature 8 reassignment.
  mentor_id          uuid not null references public.user_profiles (id) on delete cascade,
  status             public.at_risk_meeting_status not null default 'awaiting_link',
  reasons            text[] not null default array[]::text[],
  attendance_percent numeric(5,2),
  latest_gpa         numeric(4,2),
  backlog_count      integer not null default 0,

  scheduled_for      timestamptz,
  -- ── The placeholder ──────────────────────────────────────────────
  -- Populated by create_at_risk_meeting_link() once a provider is chosen.
  -- Until then both stay null and status stays 'awaiting_link'.
  meeting_provider   text,
  meeting_join_url   text,
  meeting_external_id text,

  mentor_notified_at timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  job_run_id         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint at_risk_meetings_mentor_is_not_student check (mentor_id <> student_id)
);

-- At most one live meeting per student: re-running the dispatch (which is
-- exactly what the manual trigger does, repeatedly, during testing) must
-- not pile up duplicates.
create unique index if not exists at_risk_meetings_one_open_per_student_idx
  on public.at_risk_meetings (student_id)
  where status in ('awaiting_link', 'scheduled');

create index if not exists at_risk_meetings_mentor_idx
  on public.at_risk_meetings (mentor_id, created_at desc);

drop trigger if exists trg_at_risk_meetings_updated_at on public.at_risk_meetings;
create trigger trg_at_risk_meetings_updated_at
  before update on public.at_risk_meetings
  for each row execute function public.set_updated_at_timestamp();

comment on column public.at_risk_meetings.meeting_join_url is
  'STUB. Filled in by create_at_risk_meeting_link() once Teams vs Google Meet is decided. Null is the expected value today and the rest of the flow does not depend on it.';


-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table public.student_risk_flags enable row level security;
alter table public.at_risk_meetings   enable row level security;

drop policy if exists risk_flags_select_visible on public.student_risk_flags;
drop policy if exists meetings_select_visible   on public.at_risk_meetings;
drop policy if exists meetings_update_mentor    on public.at_risk_meetings;

-- Student, their mentor, or the HOD. A cluster head is NOT on this list:
-- they supply the raw numbers and see nothing of the conclusion.
create policy risk_flags_select_visible on public.student_risk_flags
  for select to authenticated
  using (public.can_access_student(student_id));

create policy meetings_select_visible on public.at_risk_meetings
  for select to authenticated
  using (student_id = auth.uid() or mentor_id = auth.uid() or public.is_hod());

-- The organiser may mark their own meeting done or cancelled.
create policy meetings_update_mentor on public.at_risk_meetings
  for update to authenticated
  using (mentor_id = auth.uid() or public.is_hod())
  with check (mentor_id = auth.uid() or public.is_hod());

grant select         on public.student_risk_flags to authenticated;
grant select, update on public.at_risk_meetings   to authenticated;


-- ---------------------------------------------------------------------
-- 4. Notification triggers  (§10.8 — never from React)
-- ---------------------------------------------------------------------
create or replace function public.notify_on_risk_flag_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.user_profiles;
begin
  -- Only announce a transition, not every re-evaluation. Uploads happen on
  -- no fixed schedule and can repeat within a day; a mentor should not get
  -- the same alert each time.
  if tg_op = 'UPDATE' and new.is_at_risk = old.is_at_risk then
    return new;
  end if;

  select * into v_student from public.user_profiles where id = new.student_id;
  if v_student.id is null or v_student.assigned_mentor_id is null then
    return new;
  end if;

  if new.is_at_risk then
    perform public.enqueue_notification(
      v_student.assigned_mentor_id, null, 'student_at_risk',
      format('%s is now flagged as at-risk', v_student.full_name),
      array_to_string(new.reasons, ' · '),
      null, '/faculty/at-risk'
    );
  else
    perform public.enqueue_notification(
      v_student.assigned_mentor_id, null, 'at_risk_cleared',
      format('%s is no longer at-risk', v_student.full_name),
      'The latest academic data clears every at-risk condition.',
      null, '/faculty/at-risk'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_risk_flag_change on public.student_risk_flags;
create trigger trg_notify_risk_flag_change
  after insert or update on public.student_risk_flags
  for each row execute function public.notify_on_risk_flag_change();


create or replace function public.notify_on_at_risk_meeting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_name text;
begin
  select full_name into v_student_name from public.user_profiles where id = new.student_id;

  -- Sent whether or not a join link exists yet — that is the whole point of
  -- keeping the link generation isolated.
  perform public.enqueue_notification(
    new.mentor_id, null, 'at_risk_meeting_required',
    format('Schedule a meeting with %s', coalesce(v_student_name, 'your mentee')),
    case
      when new.meeting_join_url is not null
        then 'A meeting link is ready. ' || array_to_string(new.reasons, ' · ')
      else 'Flagged as at-risk. ' || array_to_string(new.reasons, ' · ')
    end,
    null, '/faculty/at-risk'
  );

  update public.at_risk_meetings set mentor_notified_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_notify_at_risk_meeting on public.at_risk_meetings;
create trigger trg_notify_at_risk_meeting
  after insert on public.at_risk_meetings
  for each row execute function public.notify_on_at_risk_meeting();


-- =====================================================================
-- 5. The evaluation itself
-- =====================================================================
create or replace function public.evaluate_student_risk(p_student_id uuid)
returns public.student_risk_flags
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row              public.student_risk_flags;
  v_previous         boolean;
  v_held             bigint;
  v_attended         bigint;
  v_attendance       numeric(5,2);
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

  -- Overall attendance = total classes attended / total classes held across
  -- every course and period. A plain average of per-course percentages
  -- would let a 4-lecture elective outweigh a 40-lecture core subject.
  select coalesce(sum(classes_held), 0), coalesce(sum(classes_attended), 0)
    into v_held, v_attended
    from public.student_attendance_records
   where student_id = p_student_id;

  if v_held > 0 then
    v_attendance := round((v_attended::numeric * 100) / v_held, 2);
    if v_attendance < 75 then
      v_low_attendance := true;
      v_reasons := v_reasons || format('Attendance %s%% (below 75%%)', v_attendance);
    end if;
  end if;

  -- Latest semester on record wins; a departmental figure and a
  -- self-reported one cannot coexist for the same semester.
  select gpa, semester_number into v_gpa, v_gpa_semester
    from public.student_semester_gpas
   where student_id = p_student_id
   order by semester_number desc
   limit 1;

  if v_gpa is not null and v_gpa < 6 then
    v_low_gpa := true;
    v_reasons := v_reasons || format('GPA %s in semester %s (below 6)', v_gpa, v_gpa_semester);
  end if;

  -- "at least one backlog on record — even a single backlog is enough".
  select count(*) into v_backlogs
    from public.student_backlogs
   where student_id = p_student_id and is_cleared = false;

  if v_backlogs >= 1 then
    v_has_backlog := true;
    v_reasons := v_reasons || format('%s uncleared backlog%s', v_backlogs, case when v_backlogs = 1 then '' else 's' end);
  end if;

  -- ANY of the three.
  v_at_risk := v_low_attendance or v_low_gpa or v_has_backlog;

  select is_at_risk into v_previous from public.student_risk_flags where student_id = p_student_id;

  insert into public.student_risk_flags as f (
    student_id, is_at_risk, low_attendance, low_gpa, has_backlog,
    attendance_percent, latest_gpa, latest_gpa_semester, backlog_count, reasons,
    first_flagged_at, last_flagged_at, cleared_at, last_evaluated_at
  )
  values (
    p_student_id, v_at_risk, v_low_attendance, v_low_gpa, v_has_backlog,
    v_attendance, v_gpa, v_gpa_semester, v_backlogs, v_reasons,
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


create or replace function public.evaluate_all_students_risk()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id        uuid;
  v_evaluated integer := 0;
  v_flagged   integer := 0;
  v_row       public.student_risk_flags;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can re-evaluate the whole cohort' using errcode = '42501';
  end if;

  for v_id in
    select id from public.user_profiles where role = 'student' and is_active
  loop
    v_row := public.evaluate_student_risk(v_id);
    v_evaluated := v_evaluated + 1;
    if v_row.is_at_risk then v_flagged := v_flagged + 1; end if;
  end loop;

  return jsonb_build_object('evaluated', v_evaluated, 'at_risk', v_flagged);
end;
$$;


-- =====================================================================
-- 6. Meeting creation  —  and the one intentionally unfinished step
-- =====================================================================
-- ┌───────────────────────────────────────────────────────────────────┐
-- │  PLACEHOLDER — DO NOT BUILD ON TOP OF THIS RETURN VALUE           │
-- │                                                                   │
-- │  Teams vs Google Meet has not been decided. This function is the  │
-- │  single seam where that decision lands: it should call the chosen │
-- │  provider, create a calendar event owned by the MENTOR, and       │
-- │  return the join URL. Until then it returns null and the meeting  │
-- │  row stays in 'awaiting_link'.                                    │
-- │                                                                   │
-- │  Nothing else in this migration reads meeting_join_url to decide  │
-- │  whether to act, so filling this in is genuinely a one-function   │
-- │  swap: set meeting_provider / meeting_join_url / status here and  │
-- │  the rest of the workflow already handles both states.            │
-- └───────────────────────────────────────────────────────────────────┘
create or replace function public.create_at_risk_meeting_link(p_meeting_id uuid)
returns public.at_risk_meetings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meeting public.at_risk_meetings;
begin
  select * into v_meeting from public.at_risk_meetings where id = p_meeting_id;
  if v_meeting.id is null then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if not (v_meeting.mentor_id = auth.uid() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only the organising mentor or the HOD can generate this link'
      using errcode = '42501';
  end if;

  -- TODO(provider): create the meeting with the mentor as organiser and
  -- set meeting_provider, meeting_join_url, meeting_external_id,
  -- scheduled_for and status = 'scheduled'. Returning the row unchanged is
  -- the correct behaviour today.
  return v_meeting;
end;
$$;

comment on function public.create_at_risk_meeting_link is
  'PLACEHOLDER. Returns the meeting unchanged until the Teams vs Google Meet decision is made. The rest of the at-risk flow does not depend on a link existing.';


-- Raise a meeting for every currently-flagged student who does not already
-- have a live one. Idempotent by design: the partial unique index means
-- running it twice in a row (which is what the manual trigger encourages)
-- creates nothing the second time.
create or replace function public.dispatch_at_risk_meetings(p_job_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flag      public.student_risk_flags;
  v_mentor    uuid;
  v_created   integer := 0;
  v_skipped   integer := 0;
  v_no_mentor integer := 0;
  v_meeting   public.at_risk_meetings;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can dispatch at-risk meetings' using errcode = '42501';
  end if;

  for v_flag in
    select * from public.student_risk_flags where is_at_risk = true
  loop
    select assigned_mentor_id into v_mentor
      from public.user_profiles where id = v_flag.student_id;

    -- The mentor owns the meeting. No mentor, no meeting — we do not fall
    -- back to the cluster head or the HOD, because the brief is explicit
    -- that the mentor is the organiser.
    if v_mentor is null then
      v_no_mentor := v_no_mentor + 1;
      continue;
    end if;

    if exists (
      select 1 from public.at_risk_meetings
       where student_id = v_flag.student_id
         and status in ('awaiting_link', 'scheduled')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.at_risk_meetings (
      student_id, mentor_id, status, reasons,
      attendance_percent, latest_gpa, backlog_count, job_run_id
    )
    values (
      v_flag.student_id, v_mentor, 'awaiting_link', v_flag.reasons,
      v_flag.attendance_percent, v_flag.latest_gpa, v_flag.backlog_count, p_job_run_id
    )
    returning * into v_meeting;

    -- Ask for a join link. Today this is a no-op; once a provider is wired
    -- in, the meeting flips to 'scheduled' without any other code moving.
    perform public.create_at_risk_meeting_link(v_meeting.id);

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'meetings_created', v_created,
    'already_open',     v_skipped,
    'without_mentor',   v_no_mentor
  );
end;
$$;


-- The organiser closes out their own meeting.
create or replace function public.set_at_risk_meeting_status(
  p_meeting_id uuid,
  p_status     public.at_risk_meeting_status
)
returns public.at_risk_meetings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meeting public.at_risk_meetings;
begin
  select * into v_meeting from public.at_risk_meetings where id = p_meeting_id;
  if v_meeting.id is null then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if not (v_meeting.mentor_id = auth.uid() or public.is_hod()) then
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
$$;


-- =====================================================================
-- 7. The at-risk roster the mentor actually looks at
-- =====================================================================
-- security_invoker = true (§10.7): a mentor sees their own mentees, the
-- HOD sees everyone, and the parent contact numbers ride along only
-- because can_access_student() already lets a mentor read their mentee's
-- Form A. No new permission is granted here.
drop view if exists public.at_risk_student_overview cascade;
create view public.at_risk_student_overview
with (security_invoker = true) as
select
  s.id                              as student_id,
  s.full_name                       as student_name,
  s.login_id                        as registration_no,
  s.email,
  s.section,
  s.branch,
  s.semester_label,
  s.assigned_mentor_id,
  m.full_name                       as mentor_name,
  f.is_at_risk,
  f.low_attendance,
  f.low_gpa,
  f.has_backlog,
  f.attendance_percent,
  f.latest_gpa,
  f.latest_gpa_semester,
  f.backlog_count,
  f.reasons,
  f.first_flagged_at,
  f.last_evaluated_at,
  -- Parent contact, surfaced only for the at-risk list.
  a.father_name,
  a.father_mobile,
  a.mother_name,
  a.mother_mobile,
  coalesce(a.father_mobile, a.mother_mobile) as primary_parent_mobile,
  meet.id                           as open_meeting_id,
  meet.status                       as open_meeting_status,
  meet.meeting_join_url             as open_meeting_join_url,
  meet.created_at                   as open_meeting_created_at
from public.user_profiles s
join public.student_risk_flags f      on f.student_id = s.id
left join public.user_profiles m      on m.id = s.assigned_mentor_id
left join public.student_form_a_profiles a on a.student_id = s.id
left join lateral (
  select id, status, meeting_join_url, created_at
    from public.at_risk_meetings
   where student_id = s.id and status in ('awaiting_link', 'scheduled')
   order by created_at desc
   limit 1
) meet on true
where s.role = 'student';

comment on view public.at_risk_student_overview is
  'Feature: at-risk roster. Attendance, GPA, backlog count and parent contact in one row so a mentor can act without opening anything. Clicking the name opens the existing student profile page.';

grant select on public.at_risk_student_overview to authenticated;


-- =====================================================================
-- 8. The upload RPCs the Cluster Head portal calls
-- =====================================================================
-- Each takes rows already parsed out of the spreadsheet by the serverless
-- endpoint, matches them to students, writes them, records the batch and
-- re-evaluates risk for exactly the students touched.
--
-- NO DATE CHECK APPEARS IN ANY OF THEM. Uploading early, late, or twice in
-- one afternoon is always permitted.

create or replace function public.record_attendance_batch(
  p_course_id    uuid,
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
  v_batch_id  uuid;
  v_item      jsonb;
  v_ident     text;
  v_student   uuid;
  v_held      integer;
  v_attended  integer;
  v_matched   integer := 0;
  v_failed    integer := 0;
  v_total     integer := 0;
  v_errors    jsonb   := '[]'::jsonb;
  v_touched   uuid[]  := array[]::uuid[];
  v_sid       uuid;
  v_actor     uuid;
begin
  -- auth.uid() is null means a trusted server call (the seed script, a
  -- migration, a SQL console) — the same escape hatch every other
  -- privileged function here uses.
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload attendance' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cluster_head_courses
     where id = p_course_id
       and (cluster_head_id = auth.uid() or public.is_hod() or auth.uid() is null)
  ) then
    raise exception 'That course is not one of yours' using errcode = '42501';
  end if;
  if p_section is null or p_section !~ '^[A-O]$' then
    raise exception 'Pick a section from the dropdown' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'The reporting period is missing or ends before it starts' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  -- On a trusted server call there is no auth.uid(); the batch still
  -- belongs to whoever owns the course, which is the useful answer.
  select coalesce(auth.uid(), c.cluster_head_id) into v_actor
    from public.cluster_head_courses c where c.id = p_course_id;

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, course_id, section_label,
    period_start, period_end, original_filename, total_rows
  )
  values (v_actor, 'attendance', p_course_id, p_section,
          p_period_start, p_period_end, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total    := v_total + 1;
    v_ident    := btrim(coalesce(v_item ->> 'identifier', ''));
    v_held     := nullif(v_item ->> 'classes_held', '')::integer;
    v_attended := nullif(v_item ->> 'classes_attended', '')::integer;

    if v_ident = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'reason', 'No registration number or email in this row');
      continue;
    end if;
    if v_held is null or v_attended is null or v_held <= 0 or v_attended < 0 or v_attended > v_held then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'Classes held / attended missing or inconsistent');
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
                                                 'reason', 'No student matches this registration number or email');
      continue;
    end if;

    -- The first upload for a course/section is what teaches the portal
    -- which students sit in it. Later uploads keep the mapping current.
    insert into public.student_course_sections (student_id, course_id, section_label)
    values (v_student, p_course_id, p_section)
    on conflict (student_id, course_id) do update
      set section_label = excluded.section_label, updated_at = now();

    insert into public.student_attendance_records (
      student_id, course_id, section_label, period_start, period_end,
      classes_held, classes_attended, batch_id, recorded_by
    )
    values (v_student, p_course_id, p_section, p_period_start, p_period_end,
            v_held, v_attended, v_batch_id, v_actor)
    on conflict (student_id, course_id, period_start) do update
      set section_label    = excluded.section_label,
          period_end       = excluded.period_end,
          classes_held     = excluded.classes_held,
          classes_attended = excluded.classes_attended,
          batch_id         = excluded.batch_id,
          recorded_by      = excluded.recorded_by,
          updated_at       = now();

    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  update public.academic_upload_batches
     set matched_rows = v_matched, failed_rows = v_failed, row_errors = v_errors
   where id = v_batch_id;

  -- Fresh data, fresh verdict — immediately, not on the 15-day boundary.
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
  if p_semester_number is null or p_semester_number < 1 or p_semester_number > 8 then
    raise exception 'Pick a semester between 1 and 8' using errcode = '22023';
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
    v_total := v_total + 1;
    v_ident := btrim(coalesce(v_item ->> 'identifier', ''));
    v_gpa   := nullif(v_item ->> 'gpa', '')::numeric;

    if v_ident = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'reason', 'No registration number or email in this row');
      continue;
    end if;
    if v_gpa is null or v_gpa < 0 or v_gpa > 10 then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident, 'reason', 'GPA must be between 0 and 10');
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
                                                 'reason', 'No student matches this registration number or email');
      continue;
    end if;

    insert into public.student_semester_gpas (
      student_id, semester_number, gpa, source, recorded_by, batch_id
    )
    values (v_student, p_semester_number, round(v_gpa, 2), 'cluster_head', auth.uid(), v_batch_id)
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


create or replace function public.record_backlog_batch(
  p_semester_number smallint,
  p_exam_session    text,
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

    select id into v_student
      from public.user_profiles
     where role = 'student' and is_active
       and (lower(coalesce(login_id, '')) = lower(v_ident) or lower(email) = lower(v_ident))
     limit 1;

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
$$;


revoke all on function public.evaluate_student_risk(uuid)                                   from public, anon;
revoke all on function public.evaluate_all_students_risk()                                  from public, anon;
revoke all on function public.create_at_risk_meeting_link(uuid)                             from public, anon;
revoke all on function public.dispatch_at_risk_meetings(uuid)                               from public, anon;
revoke all on function public.set_at_risk_meeting_status(uuid, public.at_risk_meeting_status) from public, anon;
revoke all on function public.record_attendance_batch(uuid, text, date, date, text, jsonb)  from public, anon;
revoke all on function public.record_gpa_batch(smallint, text, jsonb)                       from public, anon;
revoke all on function public.record_backlog_batch(smallint, text, text, jsonb)             from public, anon;

grant execute on function public.evaluate_student_risk(uuid)                                   to authenticated, service_role;
grant execute on function public.evaluate_all_students_risk()                                  to authenticated, service_role;
grant execute on function public.create_at_risk_meeting_link(uuid)                             to authenticated, service_role;
grant execute on function public.dispatch_at_risk_meetings(uuid)                               to authenticated, service_role;
grant execute on function public.set_at_risk_meeting_status(uuid, public.at_risk_meeting_status) to authenticated;
grant execute on function public.record_attendance_batch(uuid, text, date, date, text, jsonb)  to authenticated;
grant execute on function public.record_gpa_batch(smallint, text, jsonb)                       to authenticated;
grant execute on function public.record_backlog_batch(smallint, text, text, jsonb)             to authenticated;
