-- =====================================================================
-- 0023  The 15-day student survey + completion tracking
-- =====================================================================
-- This is deliberately NOT part of the at-risk workflow. It goes to every
-- student, flagged or not, every 15 days, and its only job is to take the
-- department's pulse and let two people chase the stragglers:
--
--   * the star mentee (student representative) — sees, for their own
--     mentor group, how many have filled it in and who has not
--   * the mentor — sees the same completion status for their mentees
--
-- WHY ONE DEPARTMENT-WIDE WINDOW
-- ---------------------------------------------------------------------
-- Cycle 7 is Aug 1-15 for everybody. The alternative (each student's own
-- rolling 15 days from their last submission) makes "how many have filled
-- it in" unanswerable, because at any moment every student is at a
-- different point in their own window. A shared window turns completion
-- into a plain count, which is exactly what the rep and the mentor asked
-- for.
--
-- The cycle is opened by open_survey_cycle(), called either by the 15-day
-- schedule or by the manual trigger in migration 0024. It is never opened
-- as a side effect of a Cluster Head upload.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The questions
-- ---------------------------------------------------------------------
-- Verbatim from the departmental feedback form. The 5-point scale is
-- Poor / Fair / Satisfactory / Good / Excellent, stored as 1-5 so it can
-- be averaged; the labels live in frontend/src/lib/constants.js.
create table if not exists public.survey_questions (
  id              uuid primary key default extensions.gen_random_uuid(),
  question_number smallint not null unique,
  prompt          text     not null,
  is_active       boolean  not null default true,
  created_at      timestamptz not null default now(),

  constraint survey_questions_prompt_not_blank check (public.is_non_blank(prompt)),
  constraint survey_questions_number_range     check (question_number between 1 and 100)
);

insert into public.survey_questions (question_number, prompt) values
  (1,  'How would you rate your mentor''s responsiveness when you raise an academic query?'),
  (2,  'How effectively does your mentor resolve the academic problems or doubts you bring to them?'),
  (3,  'How comfortable are you in approaching your mentor with personal or non-academic concerns?'),
  (4,  'How would you rate your mentor''s availability and accessibility whenever you need support?'),
  (5,  'How beneficial is the regular tracking of your academic performance by your assigned mentor?'),
  (6,  'How would you rate the usefulness of the guidance provided during scheduled mentor check-ins?'),
  (7,  'How helpful has your mentor been in guiding your academic or career-related decisions?'),
  (8,  'How well does the portal help you recognize measurable improvement in your own performance over time?'),
  (9,  'How confident are you that having an assigned mentor through the portal has positively impacted your academic journey?'),
  (10, 'How would you rate your overall experience using the Student Mentor Portal?')
on conflict (question_number) do update set prompt = excluded.prompt;


-- ---------------------------------------------------------------------
-- 2. Cycles
-- ---------------------------------------------------------------------
create table if not exists public.survey_cycles (
  id             uuid primary key default extensions.gen_random_uuid(),
  cycle_number   integer not null unique,
  opens_on       date    not null default current_date,
  closes_on      date    not null,
  is_active      boolean not null default true,
  trigger_source public.cycle_job_trigger not null default 'scheduled',
  opened_by      uuid references public.user_profiles (id) on delete set null,
  job_run_id     uuid,
  created_at     timestamptz not null default now(),

  constraint survey_cycles_window_ordered check (closes_on >= opens_on)
);

-- Only one cycle may be open at a time — the completion count means
-- nothing if students can be answering two different surveys at once.
create unique index if not exists survey_cycles_single_active_idx
  on public.survey_cycles ((is_active)) where is_active = true;

comment on table public.survey_cycles is
  'One shared 15-day survey window for the whole department. Opened by open_survey_cycle() on the schedule, or on demand via the manual trigger.';


-- ---------------------------------------------------------------------
-- 3. Responses
-- ---------------------------------------------------------------------
create table if not exists public.survey_responses (
  id           uuid primary key default extensions.gen_random_uuid(),
  cycle_id     uuid not null references public.survey_cycles (id) on delete cascade,
  student_id   uuid not null references public.user_profiles (id) on delete cascade,
  -- Snapshot: who the mentor was at the time of answering. A Feature 8
  -- reassignment afterwards must not silently re-attribute old feedback.
  mentor_id    uuid references public.user_profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),

  constraint survey_responses_one_per_cycle unique (cycle_id, student_id)
);

create index if not exists survey_responses_cycle_idx  on public.survey_responses (cycle_id);
create index if not exists survey_responses_mentor_idx on public.survey_responses (mentor_id, cycle_id);

create table if not exists public.survey_response_answers (
  id          uuid primary key default extensions.gen_random_uuid(),
  response_id uuid not null references public.survey_responses (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  rating      smallint not null,

  constraint survey_answer_rating_range check (rating between 1 and 5),
  constraint survey_answer_one_per_question unique (response_id, question_id)
);

create index if not exists survey_response_answers_response_idx
  on public.survey_response_answers (response_id);


-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table public.survey_questions        enable row level security;
alter table public.survey_cycles           enable row level security;
alter table public.survey_responses        enable row level security;
alter table public.survey_response_answers enable row level security;

drop policy if exists survey_questions_select_all   on public.survey_questions;
drop policy if exists survey_cycles_select_all      on public.survey_cycles;
drop policy if exists survey_responses_select_scope on public.survey_responses;
drop policy if exists survey_answers_select_scope   on public.survey_response_answers;

-- The questions and the current window are not secrets.
create policy survey_questions_select_all on public.survey_questions
  for select to authenticated using (true);

create policy survey_cycles_select_all on public.survey_cycles
  for select to authenticated using (true);

-- A response is visible to the student who wrote it, their mentor, and the
-- HOD — the same shape as every other student-scoped table. Note the star
-- mentee is NOT here: they get counts and names through a narrow RPC, not
-- the underlying answers.
create policy survey_responses_select_scope on public.survey_responses
  for select to authenticated
  using (public.can_access_student(student_id));

create policy survey_answers_select_scope on public.survey_response_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.survey_responses r
      where r.id = survey_response_answers.response_id
        and public.can_access_student(r.student_id)
    )
  );

-- No INSERT policy on either table: submissions go through
-- submit_survey_response() so the one-per-cycle rule and the
-- all-questions-answered rule cannot be skipped.

grant select on public.survey_questions        to authenticated;
grant select on public.survey_cycles           to authenticated;
grant select on public.survey_responses        to authenticated;
grant select on public.survey_response_answers to authenticated;


-- ---------------------------------------------------------------------
-- 5. Opening a cycle
-- ---------------------------------------------------------------------
create or replace function public.open_survey_cycle(
  p_trigger    public.cycle_job_trigger default 'scheduled',
  p_job_run_id uuid default null,
  p_window_days integer default 15
)
returns public.survey_cycles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle   public.survey_cycles;
  v_number  integer;
  v_student record;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can open a survey cycle' using errcode = '42501';
  end if;

  -- Closing the previous window is part of opening the next one, so the
  -- single-active-cycle index is never violated even when the manual
  -- trigger is pressed twice in a row during testing.
  update public.survey_cycles
     set is_active = false
   where is_active = true;

  select coalesce(max(cycle_number), 0) + 1 into v_number from public.survey_cycles;

  insert into public.survey_cycles (
    cycle_number, opens_on, closes_on, is_active, trigger_source, opened_by, job_run_id
  )
  values (
    v_number, current_date,
    current_date + (greatest(coalesce(p_window_days, 15), 1) - 1),
    true, p_trigger, auth.uid(), p_job_run_id
  )
  returning * into v_cycle;

  -- Every student, not just the flagged ones.
  for v_student in
    select id, full_name from public.user_profiles where role = 'student' and is_active
  loop
    perform public.enqueue_notification(
      v_student.id, null, 'survey_published',
      format('Mentor feedback survey #%s is open', v_cycle.cycle_number),
      format('Ten quick questions. Open until %s.', to_char(v_cycle.closes_on, 'DD Mon YYYY')),
      null, '/student/survey'
    );
  end loop;

  return v_cycle;
end;
$$;


-- Nudge whoever has not answered the currently open cycle.
create or replace function public.send_survey_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle   public.survey_cycles;
  v_student record;
  v_sent    integer := 0;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can send survey reminders' using errcode = '42501';
  end if;

  select * into v_cycle from public.survey_cycles where is_active = true limit 1;
  if v_cycle.id is null then
    return jsonb_build_object('reminders_sent', 0, 'note', 'No survey cycle is currently open');
  end if;

  for v_student in
    select p.id
      from public.user_profiles p
     where p.role = 'student' and p.is_active
       and not exists (
         select 1 from public.survey_responses r
          where r.cycle_id = v_cycle.id and r.student_id = p.id
       )
  loop
    perform public.enqueue_notification(
      v_student.id, null, 'survey_reminder',
      format('Reminder: survey #%s is still open', v_cycle.cycle_number),
      format('It closes on %s and takes about a minute.', to_char(v_cycle.closes_on, 'DD Mon YYYY')),
      null, '/student/survey'
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('cycle_number', v_cycle.cycle_number, 'reminders_sent', v_sent);
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Submitting
-- ---------------------------------------------------------------------
-- p_answers: [{ "question_number": 1, "rating": 4 }, ...]
create or replace function public.submit_survey_response(
  p_cycle_id uuid,
  p_answers  jsonb
)
returns public.survey_responses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle    public.survey_cycles;
  v_response public.survey_responses;
  v_item     jsonb;
  v_question public.survey_questions;
  v_rating   smallint;
  v_expected integer;
  v_given    integer;
begin
  if not public.is_student() then
    raise exception 'Only a student can submit the survey' using errcode = '42501';
  end if;

  select * into v_cycle from public.survey_cycles where id = p_cycle_id;
  if v_cycle.id is null then
    raise exception 'Survey not found' using errcode = 'P0002';
  end if;
  if not v_cycle.is_active then
    raise exception 'That survey cycle has closed' using errcode = '42501';
  end if;
  if exists (select 1 from public.survey_responses where cycle_id = p_cycle_id and student_id = auth.uid()) then
    raise exception 'You have already submitted this survey' using errcode = '42501';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'Answer every question before submitting' using errcode = '22023';
  end if;

  select count(*) into v_expected from public.survey_questions where is_active;
  select count(*) into v_given from jsonb_array_elements(p_answers);
  if v_given <> v_expected then
    raise exception 'Answer all % questions before submitting (got %)', v_expected, v_given
      using errcode = '22023';
  end if;

  insert into public.survey_responses (cycle_id, student_id, mentor_id)
  select p_cycle_id, auth.uid(), p.assigned_mentor_id
    from public.user_profiles p where p.id = auth.uid()
  returning * into v_response;

  for v_item in select * from jsonb_array_elements(p_answers)
  loop
    select * into v_question
      from public.survey_questions
     where question_number = (v_item ->> 'question_number')::smallint and is_active;
    if v_question.id is null then
      raise exception 'Unknown question number %', v_item ->> 'question_number' using errcode = '22023';
    end if;

    v_rating := (v_item ->> 'rating')::smallint;
    if v_rating is null or v_rating < 1 or v_rating > 5 then
      raise exception 'Every answer must be on the 1-5 scale' using errcode = '22023';
    end if;

    insert into public.survey_response_answers (response_id, question_id, rating)
    values (v_response.id, v_question.id, v_rating);
  end loop;

  return v_response;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. Completion tracking
-- ---------------------------------------------------------------------
-- security_invoker (§10.7): a mentor sees only mentees they can already
-- read, the HOD sees everyone, a student sees themselves.
drop view if exists public.survey_mentee_status cascade;
create view public.survey_mentee_status
with (security_invoker = true) as
select
  c.id                      as cycle_id,
  c.cycle_number,
  c.opens_on,
  c.closes_on,
  c.is_active               as cycle_is_active,
  s.id                      as student_id,
  s.full_name               as student_name,
  s.login_id                as registration_no,
  s.email,
  s.section,
  s.assigned_mentor_id,
  s.is_star_mentee,
  (r.id is not null)        as has_submitted,
  r.submitted_at
from public.survey_cycles c
cross join public.user_profiles s
left join public.survey_responses r on r.cycle_id = c.id and r.student_id = s.id
where s.role = 'student' and s.is_active;

comment on view public.survey_mentee_status is
  'Per-student completion status for every survey cycle. Powers the mentor''s tracking column; RLS on user_profiles scopes it to the caller''s own mentees.';

grant select on public.survey_mentee_status to authenticated;


-- Roll-up per mentor group, for the mentor's own dashboard.
drop view if exists public.survey_group_completion cascade;
create view public.survey_group_completion
with (security_invoker = true) as
select
  cycle_id,
  cycle_number,
  opens_on,
  closes_on,
  cycle_is_active,
  assigned_mentor_id,
  count(*)                                          as total_students,
  count(*) filter (where has_submitted)             as submitted_count,
  count(*) filter (where not has_submitted)         as pending_count,
  case when count(*) = 0 then 0
       else round(100.0 * count(*) filter (where has_submitted) / count(*), 1)
  end                                               as completion_percent
from public.survey_mentee_status
group by cycle_id, cycle_number, opens_on, closes_on, cycle_is_active, assigned_mentor_id;

grant select on public.survey_group_completion to authenticated;


-- ---------------------------------------------------------------------
-- 8. The star mentee's view
-- ---------------------------------------------------------------------
-- Narrow read-only projection, the same approach as
-- get_mentor_group_tickets(): the representative can see who in their own
-- group has and has not answered, so they can chase people — and nothing
-- else. No ratings, no answers, no email addresses.
create or replace function public.get_mentor_group_survey_status()
returns table (
  cycle_id        uuid,
  cycle_number    integer,
  opens_on        date,
  closes_on       date,
  student_name    text,
  registration_no text,
  section         text,
  has_submitted   boolean,
  is_me           boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     public.user_profiles;
  v_cycle  public.survey_cycles;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'student' or not coalesce(v_me.is_star_mentee, false) then
    raise exception 'Only the student representative can see group survey status'
      using errcode = '42501';
  end if;
  if v_me.assigned_mentor_id is null then
    return;
  end if;

  select * into v_cycle from public.survey_cycles where is_active = true limit 1;
  if v_cycle.id is null then
    return;
  end if;

  return query
  select v_cycle.id,
         v_cycle.cycle_number,
         v_cycle.opens_on,
         v_cycle.closes_on,
         s.full_name,
         s.login_id,
         s.section,
         (r.id is not null),
         (s.id = v_me.id)
    from public.user_profiles s
    left join public.survey_responses r on r.cycle_id = v_cycle.id and r.student_id = s.id
   where s.role = 'student'
     and s.is_active
     and s.assigned_mentor_id = v_me.assigned_mentor_id
   order by (r.id is not null), s.full_name;
end;
$$;


-- What the student's own survey page needs: the open cycle plus whether
-- they have already answered it.
create or replace function public.get_active_survey_for_student()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle    public.survey_cycles;
  v_response public.survey_responses;
begin
  if not public.is_student() then
    raise exception 'Only a student has a survey to fill in' using errcode = '42501';
  end if;

  select * into v_cycle from public.survey_cycles where is_active = true limit 1;
  if v_cycle.id is null then
    return jsonb_build_object('cycle', null, 'has_submitted', false, 'questions', '[]'::jsonb);
  end if;

  select * into v_response
    from public.survey_responses
   where cycle_id = v_cycle.id and student_id = auth.uid();

  return jsonb_build_object(
    'cycle', jsonb_build_object(
      'id', v_cycle.id,
      'cycle_number', v_cycle.cycle_number,
      'opens_on', v_cycle.opens_on,
      'closes_on', v_cycle.closes_on
    ),
    'has_submitted', v_response.id is not null,
    'submitted_at', v_response.submitted_at,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('question_number', q.question_number, 'prompt', q.prompt)
                       order by q.question_number)
        from public.survey_questions q where q.is_active
    ), '[]'::jsonb)
  );
end;
$$;


revoke all on function public.open_survey_cycle(public.cycle_job_trigger, uuid, integer) from public, anon;
revoke all on function public.send_survey_reminders()                                    from public, anon;
revoke all on function public.submit_survey_response(uuid, jsonb)                        from public, anon;
revoke all on function public.get_mentor_group_survey_status()                           from public, anon;
revoke all on function public.get_active_survey_for_student()                            from public, anon;

grant execute on function public.open_survey_cycle(public.cycle_job_trigger, uuid, integer) to authenticated, service_role;
grant execute on function public.send_survey_reminders()                                    to authenticated, service_role;
grant execute on function public.submit_survey_response(uuid, jsonb)                        to authenticated;
grant execute on function public.get_mentor_group_survey_status()                           to authenticated;
grant execute on function public.get_active_survey_for_student()                            to authenticated;
